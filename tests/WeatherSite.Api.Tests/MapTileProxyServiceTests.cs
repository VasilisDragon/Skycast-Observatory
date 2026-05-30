using System.Net;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using WeatherSite.Api.Services;

namespace WeatherSite.Api.Tests;

public sealed class MapTileProxyServiceTests
{
    [Fact]
    public async Task GetTileAsync_RejectsOversizedTileWithoutCaching()
    {
        MapLayerCatalog.BuildForLocation("KLOT");
        var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(new byte[1_048_577])
        };
        response.Content.Headers.ContentType = new("image/png");

        var service = CreateService(_ => response);

        await Assert.ThrowsAsync<HttpRequestException>(() =>
            service.GetTileAsync("opengeo", "local-radar-klot", 7, 32, 48, "2026-04-07T14:05:00Z", CancellationToken.None));
    }

    private static MapTileProxyService CreateService(Func<HttpRequestMessage, HttpResponseMessage> handler)
    {
        var client = new HttpClient(new StubHttpMessageHandler(handler));
        var cache = new MemoryCache(new MemoryCacheOptions { SizeLimit = 1024 });
        return new MapTileProxyService(new StubHttpClientFactory(client), cache, NullLogger<MapTileProxyService>.Instance);
    }
}
