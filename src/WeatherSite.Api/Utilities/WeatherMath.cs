using System.Globalization;
using System.Text.RegularExpressions;

namespace WeatherSite.Api.Utilities;

public static partial class WeatherMath
{
    private const double MilesPerMeter = 0.000621371;
    private const double InchesHgPerPascal = 0.00029529983071445;
    private const double MphPerKilometerHour = 0.621371;

    public static double CelsiusToFahrenheit(double celsius) => (celsius * 9d / 5d) + 32d;

    public static double? CelsiusToFahrenheit(double? celsius) => celsius is null ? null : CelsiusToFahrenheit(celsius.Value);

    public static double? MetersToMiles(double? meters) => meters is null ? null : Math.Round(meters.Value * MilesPerMeter, 1);

    public static double? PascalsToInchesHg(double? pascals) => pascals is null ? null : Math.Round(pascals.Value * InchesHgPerPascal, 2);

    public static double? KilometersPerHourToMilesPerHour(double? kilometersPerHour) =>
        kilometersPerHour is null ? null : Math.Round(kilometersPerHour.Value * MphPerKilometerHour, 1);

    public static double ExtractMaxWindSpeedMph(string? windSpeedText)
    {
        if (string.IsNullOrWhiteSpace(windSpeedText))
        {
            return 0d;
        }

        var matches = WindValueRegex().Matches(windSpeedText);
        if (matches.Count == 0)
        {
            return 0d;
        }

        var max = matches
            .Select(match => double.Parse(match.Value, CultureInfo.InvariantCulture))
            .Max();

        return Math.Round(max, 1);
    }

    [GeneratedRegex(@"\d+(\.\d+)?", RegexOptions.Compiled)]
    private static partial Regex WindValueRegex();

    private const double EarthRadiusMiles = 3958.7613;

    public static double HaversineMiles(double lat1, double lon1, double lat2, double lon2)
    {
        var dLat = DegreesToRadians(lat2 - lat1);
        var dLon = DegreesToRadians(lon2 - lon1);
        var a =
            Math.Sin(dLat / 2d) * Math.Sin(dLat / 2d)
            + Math.Cos(DegreesToRadians(lat1)) * Math.Cos(DegreesToRadians(lat2))
              * Math.Sin(dLon / 2d) * Math.Sin(dLon / 2d);
        var c = 2d * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1d - a));
        return EarthRadiusMiles * c;
    }

    private static double DegreesToRadians(double degrees) => degrees * Math.PI / 180d;
}
