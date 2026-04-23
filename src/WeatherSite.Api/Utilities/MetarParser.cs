using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using WeatherSite.Api.Contracts;

namespace WeatherSite.Api.Utilities;

public static partial class MetarParser
{
    private const double MillibarToInchesHg = 0.0295299830714;

    public static IReadOnlyList<MetarObservationDto> Parse(string? json, ILogger? logger = null)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return Array.Empty<MetarObservationDto>();
        }

        try
        {
            var root = JsonNode.Parse(json);
            var array = root as JsonArray ?? root?["data"] as JsonArray;
            if (array is null)
            {
                return Array.Empty<MetarObservationDto>();
            }

            var results = new List<MetarObservationDto>(array.Count);
            foreach (var item in array)
            {
                var parsed = ParseOne(item);
                if (parsed is not null)
                {
                    results.Add(parsed);
                }
            }

            results.Sort((a, b) =>
                Nullable.Compare(b.ObservedAtUtc, a.ObservedAtUtc));
            return results;
        }
        catch (Exception exception)
        {
            logger?.LogWarning(exception, "METAR parser drift: {Snippet}", Snippet(json));
            return Array.Empty<MetarObservationDto>();
        }
    }

    private static MetarObservationDto? ParseOne(JsonNode? node)
    {
        if (node is null)
        {
            return null;
        }

        var icao = node.GetString("icaoId") ?? node.GetString("station_id");
        if (string.IsNullOrWhiteSpace(icao))
        {
            return null;
        }

        var clouds = ParseClouds(node["clouds"] as JsonArray).ToArray();
        var visibility = ParseVisibility(node["visib"].AsString());
        var ceiling = CeilingFromClouds(clouds);
        var altimeterMb = node.GetDouble("altim");
        var altimeterInHg = altimeterMb is null ? null : (double?)Math.Round(altimeterMb.Value * MillibarToInchesHg, 2);
        var category = FlightCategoryCalculator.Compute(ceiling, visibility);

        return new MetarObservationDto(
            icao.Trim().ToUpperInvariant(),
            node.GetString("name"),
            ParseTimestamp(node, "obsTime", "reportTime", "receiptTime"),
            node.GetDouble("temp"),
            node.GetDouble("dewp"),
            node.GetInt("wdir"),
            node.GetDouble("wspd"),
            node.GetDouble("wgst"),
            visibility,
            altimeterInHg,
            node.GetString("wxString"),
            clouds,
            node.GetString("rawOb"),
            new FlightCategoryDto(FlightCategoryCalculator.ToLabel(category), ceiling, visibility),
            node.GetDouble("lat"),
            node.GetDouble("lon"),
            node.GetInt("elev"));
    }

    internal static IEnumerable<CloudLayerDto> ParseClouds(JsonArray? clouds)
    {
        if (clouds is null)
        {
            yield break;
        }

        foreach (var layer in clouds)
        {
            var cover = layer?.GetString("cover");
            if (string.IsNullOrWhiteSpace(cover))
            {
                continue;
            }
            yield return new CloudLayerDto(cover.ToUpperInvariant(), layer.GetInt("base"));
        }
    }

    internal static double? ParseVisibility(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var text = raw.Trim();
        if (text.EndsWith('+'))
        {
            text = text[..^1];
        }

        if (double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var simple))
        {
            return simple;
        }

        var match = FractionRegex().Match(text);
        if (match.Success)
        {
            var whole = match.Groups["whole"].Success
                ? double.Parse(match.Groups["whole"].Value, CultureInfo.InvariantCulture)
                : 0d;
            var numerator = double.Parse(match.Groups["num"].Value, CultureInfo.InvariantCulture);
            var denominator = double.Parse(match.Groups["den"].Value, CultureInfo.InvariantCulture);
            if (denominator > 0d)
            {
                return whole + numerator / denominator;
            }
        }

        return null;
    }

    internal static int? CeilingFromClouds(IReadOnlyList<CloudLayerDto> clouds)
    {
        foreach (var layer in clouds)
        {
            if (layer.BaseFt is null)
            {
                continue;
            }
            if (layer.Cover is "BKN" or "OVC" or "VV")
            {
                return layer.BaseFt;
            }
        }
        return null;
    }

    private static DateTimeOffset? ParseTimestamp(JsonNode node, params string[] propertyNames)
    {
        foreach (var name in propertyNames)
        {
            var child = node[name];
            if (child is null)
            {
                continue;
            }

            if (child.AsDouble() is double epoch && epoch > 1_000_000_000d)
            {
                return DateTimeOffset.FromUnixTimeSeconds((long)epoch);
            }

            var text = child.AsString();
            if (!string.IsNullOrWhiteSpace(text)
                && DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var dto))
            {
                return dto.ToUniversalTime();
            }
        }
        return null;
    }

    private static string Snippet(string json) =>
        json.Length <= 200 ? json : json[..200] + "…";

    [GeneratedRegex(@"^\s*((?<whole>\d+)\s+)?(?<num>\d+)/(?<den>\d+)\s*$", RegexOptions.Compiled)]
    private static partial Regex FractionRegex();
}
