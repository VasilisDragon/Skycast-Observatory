using System.Globalization;
using System.Text.RegularExpressions;
using WeatherSite.Api.Contracts;

namespace WeatherSite.Api.Utilities;

/// <summary>
/// FB (winds/temps aloft) is a fixed-width text product. Format has drifted
/// historically, so parsing is defensive: any exception yields an empty
/// station list plus a structured warning log so operators can spot drift.
/// </summary>
public static partial class FbParser
{
    private static readonly int[] FixedAltitudes =
    [
        3000, 6000, 9000, 12000, 18000, 24000, 30000, 34000, 39000
    ];

    public static (IReadOnlyList<WindsAloftStationDto> Stations, DateTimeOffset? ValidFromUtc, DateTimeOffset? ValidToUtc)
        Parse(string? text, ILogger? logger = null)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return (Array.Empty<WindsAloftStationDto>(), null, null);
        }

        try
        {
            var lines = text.Replace("\r", string.Empty).Split('\n', StringSplitOptions.RemoveEmptyEntries);
            DateTimeOffset? validFrom = null;
            DateTimeOffset? validTo = null;
            var altitudes = FixedAltitudes;
            var stations = new List<WindsAloftStationDto>();
            var inDataSection = false;

            foreach (var rawLine in lines)
            {
                var line = rawLine.TrimEnd();
                if (line.StartsWith("VALID", StringComparison.OrdinalIgnoreCase))
                {
                    var match = ValidRegex().Match(line);
                    if (match.Success)
                    {
                        validFrom = ParseDdhh(match.Groups["valid"].Value);
                        validTo = ParseUseWindow(match.Groups["use"].Value);
                    }
                    continue;
                }
                if (line.StartsWith("FT", StringComparison.OrdinalIgnoreCase))
                {
                    altitudes = ParseAltitudes(line);
                    inDataSection = true;
                    continue;
                }
                if (!inDataSection || line.Length < 4)
                {
                    continue;
                }

                var station = ParseStationLine(line, altitudes);
                if (station is not null)
                {
                    stations.Add(station);
                }
            }

            return (stations, validFrom, validTo);
        }
        catch (Exception exception)
        {
            logger?.LogWarning(
                exception,
                "FB winds-aloft parser drift. length={Length} first_line={FirstLine}",
                text.Length,
                Snippet(text));
            return (Array.Empty<WindsAloftStationDto>(), null, null);
        }
    }

    private static int[] ParseAltitudes(string header)
    {
        var tokens = header.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var values = new List<int>(tokens.Length);
        foreach (var token in tokens)
        {
            if (token.Equals("FT", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            if (int.TryParse(token, NumberStyles.Integer, CultureInfo.InvariantCulture, out var altitude))
            {
                values.Add(altitude);
            }
        }
        return values.Count > 0 ? values.ToArray() : FixedAltitudes;
    }

    private static WindsAloftStationDto? ParseStationLine(string line, int[] altitudes)
    {
        var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2)
        {
            return null;
        }

        var stationId = parts[0].ToUpperInvariant();
        if (stationId.Length < 3 || stationId.Length > 4)
        {
            return null;
        }

        var levels = new List<WindsAloftLevelDto>(Math.Min(parts.Length - 1, altitudes.Length));
        for (var index = 0; index < altitudes.Length && index + 1 < parts.Length; index++)
        {
            var token = parts[index + 1];
            var level = ParseLevelToken(altitudes[index], token);
            if (level is not null)
            {
                levels.Add(level);
            }
        }

        return new WindsAloftStationDto(stationId, levels);
    }

    private static WindsAloftLevelDto? ParseLevelToken(int altitudeFt, string token)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length < 4)
        {
            return null;
        }

        if (token.Equals("9900", StringComparison.Ordinal))
        {
            return new WindsAloftLevelDto(altitudeFt, null, 0, null);
        }

        if (!int.TryParse(token.AsSpan(0, 2), NumberStyles.Integer, CultureInfo.InvariantCulture, out var dirTens)
            || !int.TryParse(token.AsSpan(2, 2), NumberStyles.Integer, CultureInfo.InvariantCulture, out var speedRaw))
        {
            return null;
        }

        var speedKt = speedRaw;
        var direction = dirTens * 10;
        if (direction >= 510)
        {
            direction -= 500;
            speedKt += 100;
        }
        if (direction > 360)
        {
            return null;
        }

        int? temperature = null;
        if (token.Length >= 7
            && int.TryParse(token.AsSpan(4, 3), NumberStyles.Integer, CultureInfo.InvariantCulture, out var rawTemp))
        {
            temperature = altitudeFt >= 24000 ? -Math.Abs(rawTemp) : rawTemp;
        }

        return new WindsAloftLevelDto(altitudeFt, direction, speedKt, temperature);
    }

    private static DateTimeOffset? ParseDdhh(string value)
    {
        var digits = value.Trim().TrimEnd('Z');
        if (digits.Length != 6 || !int.TryParse(digits.AsSpan(0, 2), out var day)
            || !int.TryParse(digits.AsSpan(2, 2), out var hour)
            || !int.TryParse(digits.AsSpan(4, 2), out var minute))
        {
            return null;
        }

        var now = DateTimeOffset.UtcNow;
        try
        {
            return new DateTimeOffset(now.Year, now.Month, day, hour, minute, 0, TimeSpan.Zero);
        }
        catch (ArgumentOutOfRangeException)
        {
            return null;
        }
    }

    private static DateTimeOffset? ParseUseWindow(string value)
    {
        var match = UseRangeRegex().Match(value);
        if (!match.Success)
        {
            return null;
        }

        var endDigits = match.Groups["end"].Value;
        if (endDigits.Length != 4 || !int.TryParse(endDigits.AsSpan(0, 2), out var endHour)
            || !int.TryParse(endDigits.AsSpan(2, 2), out var endMinute))
        {
            return null;
        }

        var now = DateTimeOffset.UtcNow;
        try
        {
            return new DateTimeOffset(now.Year, now.Month, now.Day, endHour, endMinute, 0, TimeSpan.Zero);
        }
        catch (ArgumentOutOfRangeException)
        {
            return null;
        }
    }

    private static string Snippet(string text) =>
        text.Length <= 80 ? text : text[..80] + "…";

    [GeneratedRegex(@"VALID\s+(?<valid>\d{6}Z?)\s+FOR USE\s+(?<use>\d{4}-\d{4}Z?)", RegexOptions.Compiled | RegexOptions.IgnoreCase)]
    private static partial Regex ValidRegex();

    [GeneratedRegex(@"(?<start>\d{4})-(?<end>\d{4})Z?", RegexOptions.Compiled)]
    private static partial Regex UseRangeRegex();
}
