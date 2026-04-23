using WeatherSite.Api.Utilities;

namespace WeatherSite.Api.Tests;

public sealed class WeatherMathTests
{
    [Fact]
    public void ExtractMaxWindSpeedMph_UsesHighestNumber()
    {
        var value = WeatherMath.ExtractMaxWindSpeedMph("10 to 25 mph");

        Assert.Equal(25d, value);
    }

    [Fact]
    public void CelsiusToFahrenheit_ConvertsExpectedValue()
    {
        var value = WeatherMath.CelsiusToFahrenheit(0d);

        Assert.Equal(32d, value);
    }

    [Fact]
    public void WebMercatorBoundingBox_CoversWholeWorldAtZoomZero()
    {
        var bbox = WebMercatorTileMath.GetBoundingBox(0, 0, 0);
        var parts = bbox.Split(',').Select(double.Parse).ToArray();

        Assert.Equal(4, parts.Length);
        Assert.True(parts[0] < parts[2]);
        Assert.True(parts[1] < parts[3]);
        Assert.InRange(parts[0], -20037509, -20037508);
        Assert.InRange(parts[2], 20037508, 20037509);
    }
}
