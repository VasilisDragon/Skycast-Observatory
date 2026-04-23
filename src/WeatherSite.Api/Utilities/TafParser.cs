using System.Globalization;
using System.Text.Json.Nodes;
using WeatherSite.Api.Contracts;

namespace WeatherSite.Api.Utilities;

public static class TafParser
{
    public static TafReportDto? Parse(string? json, ILogger? logger = null)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            var root = JsonNode.Parse(json);
            var array = root as JsonArray ?? root?["data"] as JsonArray;
            if (array is null || array.Count == 0)
            {
                return null;
            }

            var entry = array[0];
            if (entry is null)
            {
                return null;
            }

            var icao = entry.GetString("icaoId");
            if (string.IsNullOrWhiteSpace(icao))
            {
                return null;
            }

            var periods = ParsePeriods(entry["fcsts"] as JsonArray, logger).ToArray();
            return new TafReportDto(
                icao.Trim().ToUpperInvariant(),
                entry.GetString("name"),
                ParseInstant(entry, "issueTime"),
                ParseEpochSeconds(entry["validTimeFrom"]) ?? ParseInstant(entry, "validTimeFrom"),
                ParseEpochSeconds(entry["validTimeTo"]) ?? ParseInstant(entry, "validTimeTo"),
                entry.GetString("rawTAF"),
                periods,
                entry.GetDouble("lat"),
                entry.GetDouble("lon"));
        }
        catch (Exception exception)
        {
            logger?.LogWarning(exception, "TAF parser drift: {Snippet}", Snippet(json));
            return null;
        }
    }

    private static IEnumerable<TafPeriodDto> ParsePeriods(JsonArray? periods, ILogger? logger)
    {
        if (periods is null)
        {
            yield break;
        }

        foreach (var period in periods)
        {
            if (period is null)
            {
                continue;
            }

            var from = ParseEpochSeconds(period["timeFrom"]);
            var to = ParseEpochSeconds(period["timeTo"]);
            if (from is null || to is null)
            {
                logger?.LogDebug("Skipping TAF period with missing time window.");
                continue;
            }

            var clouds = MetarParser.ParseClouds(period["clouds"] as JsonArray).ToArray();
            var ceiling = MetarParser.CeilingFromClouds(clouds);
            var visibility = period.GetDouble("visib");
            var category = FlightCategoryCalculator.Compute(ceiling, visibility);

            yield return new TafPeriodDto(
                from.Value,
                to.Value,
                period.GetString("fcstChange"),
                period.GetInt("probability"),
                period.GetInt("wdir"),
                period.GetDouble("wspd"),
                period.GetDouble("wgst"),
                visibility,
                period.GetString("wxString"),
                clouds,
                new FlightCategoryDto(FlightCategoryCalculator.ToLabel(category), ceiling, visibility));
        }
    }

    private static DateTimeOffset? ParseInstant(JsonNode node, string propertyName)
    {
        var child = node[propertyName];
        if (child is null)
        {
            return null;
        }

        var epoch = ParseEpochSeconds(child);
        if (epoch is not null)
        {
            return epoch;
        }

        var text = child.AsString();
        if (!string.IsNullOrWhiteSpace(text)
            && DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var dto))
        {
            return dto.ToUniversalTime();
        }
        return null;
    }

    private static DateTimeOffset? ParseEpochSeconds(JsonNode? node)
    {
        var value = node?.AsDouble();
        if (value is null || value < 1_000_000_000d)
        {
            return null;
        }
        return DateTimeOffset.FromUnixTimeSeconds((long)value.Value);
    }

    private static string Snippet(string json) =>
        json.Length <= 200 ? json : json[..200] + "…";
}
