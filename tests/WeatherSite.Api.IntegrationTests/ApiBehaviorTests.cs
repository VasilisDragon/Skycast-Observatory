using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using WeatherSite.Api.Contracts;

namespace WeatherSite.Api.IntegrationTests;

public sealed class ApiBehaviorTests : IClassFixture<WeatherSiteApplicationFactory>
{
    private readonly WeatherSiteApplicationFactory _factory;

    public ApiBehaviorTests(WeatherSiteApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task SaveHomeLocation_SetsSecureCookie_AndCanBeReadBack()
    {
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            BaseAddress = new Uri("https://localhost")
        });

        var response = await client.PostAsJsonAsync("/api/session/home-location", new { zip = "60601" });
        var payload = await response.Content.ReadFromJsonAsync<SaveHomeLocationResponse>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.NotNull(payload);
        Assert.Equal("60601", payload!.SavedLocation.Zip);
        Assert.Equal("60601", payload.Bundle.Overview.Location.Zip);
        Assert.Contains("weather_home_zip=", response.Headers.GetValues("Set-Cookie").Single());
        Assert.Contains("secure", response.Headers.GetValues("Set-Cookie").Single(), StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", response.Headers.GetValues("Set-Cookie").Single(), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("60601|", response.Headers.GetValues("Set-Cookie").Single(), StringComparison.Ordinal);

        var getResponse = await client.GetAsync("/api/session/home-location");
        var saved = await getResponse.Content.ReadFromJsonAsync<SavedLocationPreference>();

        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);
        Assert.NotNull(saved);
        Assert.Equal("60601", saved!.Zip);
    }

    [Fact]
    public async Task WeatherOverview_UsesCookieZip_WhenQueryMissing()
    {
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost")
        });

        await client.PostAsJsonAsync("/api/session/home-location", new { zip = "60601" });

        var overview = await client.GetFromJsonAsync<WeatherOverviewResponse>("/api/weather/overview");

        Assert.NotNull(overview);
        Assert.Equal("60601", overview!.Location.Zip);
        Assert.Equal("Chicago", overview.Location.City);
    }

    [Fact]
    public async Task WeatherBundle_ReturnsOverviewAndMapConfig()
    {
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost")
        });

        var bundle = await client.GetFromJsonAsync<WeatherBundleResponse>("/api/weather/bundle?zip=60601");

        Assert.NotNull(bundle);
        Assert.Equal("60601", bundle!.Overview.Location.Zip);
        Assert.Equal("60601", bundle.MapConfig.Location.Zip);
        Assert.NotEmpty(bundle.MapConfig.Layers);
    }

    [Fact]
    public async Task TileProxy_ReturnsPngWithCacheHeader()
    {
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost")
        });

        await client.GetAsync("/api/maps/config?zip=60601");
        var response = await client.GetAsync("/api/maps/tiles/opengeo/local-radar-klot/7/32/48.png?time=2026-04-07T14:05:00Z");
        var bytes = await response.Content.ReadAsByteArrayAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("image/png", response.Content.Headers.ContentType?.MediaType);
        Assert.NotEmpty(bytes);
        Assert.Contains("max-age=60", response.Headers.CacheControl?.ToString());
    }

    [Fact]
    public async Task SpaFallback_ReturnsIndexHtml()
    {
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost")
        });

        var response = await client.GetAsync("/deep/link");
        var content = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("text/html", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("Stormglass", content, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task SpaFallback_AllowsHttpOrigin_WhenOriginHttpsRedirectionIsDisabled()
    {
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            BaseAddress = new Uri("http://localhost")
        });

        var response = await client.GetAsync("/");
        var content = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("text/html", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("Stormglass", content, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task SpaFallback_ReturnsSecurityHeaders()
    {
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost")
        });

        var response = await client.GetAsync("/");

        Assert.True(response.Headers.TryGetValues("Content-Security-Policy", out var cspValues));
        Assert.Contains("default-src 'self'", cspValues.Single());
        Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
    }
}
