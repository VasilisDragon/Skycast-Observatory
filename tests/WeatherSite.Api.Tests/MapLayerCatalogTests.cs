using WeatherSite.Api.Services;

namespace WeatherSite.Api.Tests;

public sealed class MapLayerCatalogTests
{
    [Fact]
    public void Resolve_RejectsUnregisteredLocalRadarStations()
    {
        var definition = MapLayerCatalog.Resolve("opengeo", "local-radar-kzzz");

        Assert.Null(definition);
    }

    [Fact]
    public void Resolve_RejectsMalformedLocalRadarStations()
    {
        var definition = MapLayerCatalog.Resolve("opengeo", "local-radar-klot..");

        Assert.Null(definition);
    }

    [Fact]
    public void BuildForLocation_RegistersSafeLocalRadarStations()
    {
        _ = MapLayerCatalog.BuildForLocation("KQWX");

        var definition = MapLayerCatalog.Resolve("opengeo", "local-radar-kqwx");

        Assert.NotNull(definition);
        Assert.Equal("https://opengeo.ncep.noaa.gov/geoserver/kqwx/ows", definition!.ServiceUrl);
    }
}
