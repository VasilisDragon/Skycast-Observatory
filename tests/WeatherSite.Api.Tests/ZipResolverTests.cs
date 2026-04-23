using System.Net;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using WeatherSite.Api.Configuration;
using WeatherSite.Api.Services;

namespace WeatherSite.Api.Tests;

public sealed class ZipResolverTests : IDisposable
{
    private readonly string _tempDirectory;

    public ZipResolverTests()
    {
        _tempDirectory = Path.Combine(Path.GetTempPath(), "weather-site-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_tempDirectory);
        Directory.CreateDirectory(Path.Combine(_tempDirectory, "App_Data"));
    }

    [Fact]
    public async Task ResolveAsync_UsesExactCentroidLookup_WhenZipExists()
    {
        await File.WriteAllTextAsync(
            Path.Combine(_tempDirectory, "App_Data", "zcta-centroids.json"),
            """
            {"entries":{"60601":[41.8864,-87.6186]}}
            """,
            Encoding.UTF8);

        var resolver = CreateResolver(new HttpClient(new StubHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound))));

        var location = await resolver.ResolveAsync("60601", CancellationToken.None);

        Assert.Equal("60601", location.Zip);
        Assert.Equal(41.8864, location.Latitude, 3);
        Assert.Equal(-87.6186, location.Longitude, 3);
        Assert.False(location.IsApproximate);
    }

    [Fact]
    public async Task ResolveAsync_FallsBackToOpenMeteo_WhenZipMissing()
    {
        await File.WriteAllTextAsync(
            Path.Combine(_tempDirectory, "App_Data", "zcta-centroids.json"),
            """{"entries":{}}""",
            Encoding.UTF8);

        var client = new HttpClient(
            new StubHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    """
                    {
                      "results": [
                        {
                          "name": "Beverly Hills",
                          "admin1": "California",
                          "latitude": 34.0901,
                          "longitude": -118.4065,
                          "postcodes": ["90210"]
                        }
                      ]
                    }
                    """,
                    Encoding.UTF8,
                    "application/json")
            }));

        var resolver = CreateResolver(client);

        var location = await resolver.ResolveAsync("90210", CancellationToken.None);

        Assert.True(location.IsApproximate);
        Assert.Equal("Beverly Hills", location.FallbackCity);
        Assert.Equal("California", location.FallbackState);
    }

    [Fact]
    public async Task ResolveAsync_RejectsInvalidZip()
    {
        await File.WriteAllTextAsync(
            Path.Combine(_tempDirectory, "App_Data", "zcta-centroids.json"),
            """{"entries":{}}""",
            Encoding.UTF8);

        var resolver = CreateResolver(new HttpClient(new StubHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound))));

        await Assert.ThrowsAsync<ZipResolutionException>(() => resolver.ResolveAsync("abc", CancellationToken.None));
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDirectory))
        {
            Directory.Delete(_tempDirectory, recursive: true);
        }
    }

    private ZipResolver CreateResolver(HttpClient client)
    {
        var environment = new TestWebHostEnvironment(_tempDirectory);
        var options = Options.Create(new WeatherSiteOptions
        {
            ZipCentroidsPath = "App_Data/zcta-centroids.json"
        });

        return new ZipResolver(
            environment,
            options,
            new StubHttpClientFactory(client),
            NullLogger<ZipResolver>.Instance);
    }
}
