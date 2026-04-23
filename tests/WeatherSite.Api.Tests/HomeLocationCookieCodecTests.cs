using Microsoft.AspNetCore.DataProtection;
using WeatherSite.Api.Utilities;

namespace WeatherSite.Api.Tests;

public sealed class HomeLocationCookieCodecTests : IDisposable
{
    private readonly string _tempDirectory;
    private readonly IHomeLocationCookieCodec _codec;

    public HomeLocationCookieCodecTests()
    {
        _tempDirectory = Path.Combine(Path.GetTempPath(), "weather-site-cookie-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_tempDirectory);
        var provider = DataProtectionProvider.Create(new DirectoryInfo(_tempDirectory));
        _codec = new HomeLocationCookieCodec(provider);
    }

    [Fact]
    public void SerializeAndParse_RoundTripsValue()
    {
        var savedAt = new DateTimeOffset(2026, 4, 7, 12, 30, 0, TimeSpan.Zero);
        var encoded = _codec.Serialize("60601", savedAt);

        var success = _codec.TryParse(encoded, out var parsed);

        Assert.True(success);
        Assert.NotNull(parsed);
        Assert.Equal("60601", parsed!.Zip);
        Assert.Equal(savedAt, parsed.SavedAtUtc);
    }

    [Fact]
    public void TryParse_RejectsMalformedValues()
    {
        var success = _codec.TryParse("bad-cookie", out var parsed);

        Assert.False(success);
        Assert.Null(parsed);
    }

    [Fact]
    public void TryParse_RejectsTamperedValues()
    {
        var encoded = _codec.Serialize("60601", new DateTimeOffset(2026, 4, 7, 12, 30, 0, TimeSpan.Zero));
        var tampered = $"{encoded}tampered";

        var success = _codec.TryParse(tampered, out var parsed);

        Assert.False(success);
        Assert.Null(parsed);
    }

    [Fact]
    public void TryParse_RejectsLegacyUnsignedValues()
    {
        var success = _codec.TryParse("60601|1775565000", out var parsed);

        Assert.False(success);
        Assert.Null(parsed);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDirectory))
        {
            Directory.Delete(_tempDirectory, recursive: true);
        }
    }
}
