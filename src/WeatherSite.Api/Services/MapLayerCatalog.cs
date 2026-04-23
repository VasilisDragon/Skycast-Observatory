using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using WeatherSite.Api.Contracts;

namespace WeatherSite.Api.Services;

internal sealed record WmsLayerDefinition(
    string Id,
    string Provider,
    string Layer,
    string Title,
    string Description,
    string ServiceUrl,
    string WmsLayerName,
    string? TimeDimensionName,
    double DefaultOpacity,
    bool DefaultVisible,
    string LegendTitle,
    IReadOnlyList<MapLegendEntry> Legend,
    int TileCacheSeconds)
{
    public bool SupportsTime => !string.IsNullOrWhiteSpace(TimeDimensionName);
}

internal static class MapLayerCatalog
{
    private static readonly ConcurrentDictionary<string, byte> RegisteredRadarStations = new(StringComparer.OrdinalIgnoreCase);
    private static readonly Regex RadarStationPattern = new("^[A-Z][A-Z0-9]{3}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly IReadOnlyList<WmsLayerDefinition> StaticLayers =
    [
        new(
            "conus-radar",
            "opengeo",
            "conus-radar",
            "CONUS Radar",
            "National base reflectivity composite from NOAA OpenGeo.",
            "https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows",
            "conus_bref_qcd",
            "time",
            0.88,
            false,
            "Reflectivity",
            CreateRadarLegend(),
            60),
        new(
            "hazards",
            "opengeo",
            "hazards",
            "Active Hazards",
            "Current watch, warning, and advisory polygons.",
            "https://opengeo.ncep.noaa.gov/geoserver/wwa/hazards/ows",
            "hazards",
            null,
            0.84,
            true,
            "Hazards",
            CreateHazardsLegend(),
            120),
        new(
            "forecast-high-temp",
            "ndfd",
            "forecast-high-temp",
            "High Temperature",
            "NDFD high temperature forecast surface.",
            "https://digital.weather.gov/ndfd.conus/wms",
            "ndfd.conus.maxt",
            "vtit",
            0.82,
            false,
            "High Temperature (F)",
            CreateTemperatureLegend(),
            300),
        new(
            "forecast-wind",
            "ndfd",
            "forecast-wind",
            "Wind Speed",
            "NDFD wind speed forecast surface.",
            "https://digital.weather.gov/ndfd.conus/wms",
            "ndfd.conus.windspd",
            "vtit",
            0.76,
            false,
            "Wind Speed (mph)",
            CreateWindLegend(),
            300),
        new(
            "forecast-sky",
            "ndfd",
            "forecast-sky",
            "Sky Cover",
            "Cloud coverage forecast from NDFD.",
            "https://digital.weather.gov/ndfd.conus/wms",
            "ndfd.conus.sky",
            "vtit",
            0.72,
            false,
            "Sky Cover",
            CreateSkyLegend(),
            300),
        new(
            "forecast-pop",
            "ndfd",
            "forecast-pop",
            "12-Hour Precip Chance",
            "NDFD 12-hour precipitation probability.",
            "https://digital.weather.gov/ndfd.conus/wms",
            "ndfd.conus.pop12",
            "vtit",
            0.76,
            false,
            "Chance of Precipitation",
            CreatePopLegend(),
            300),
        new(
            "forecast-qpf",
            "ndfd",
            "forecast-qpf",
            "Total Precipitation",
            "Forecast quantitative precipitation from NDFD.",
            "https://digital.weather.gov/ndfd.conus/wms",
            "ndfd.conus.totalqpf",
            "vtit",
            0.78,
            false,
            "Total Precipitation",
            CreateQpfLegend(),
            300)
    ];

    public static IReadOnlyList<WmsLayerDefinition> BuildForLocation(string? radarStation)
    {
        var layers = new List<WmsLayerDefinition>();
        if (TryRegisterRadarStation(radarStation, out var normalizedRadarStation))
        {
            layers.Add(CreateLocalRadar(normalizedRadarStation));
        }

        layers.AddRange(StaticLayers);
        return layers;
    }

    public static WmsLayerDefinition? Resolve(string provider, string layer)
    {
        if (string.Equals(provider, "opengeo", StringComparison.OrdinalIgnoreCase)
            && layer.StartsWith("local-radar-", StringComparison.OrdinalIgnoreCase))
        {
            var station = layer["local-radar-".Length..];
            if (TryResolveRegisteredRadarStation(station, out var normalizedRadarStation))
            {
                return CreateLocalRadar(normalizedRadarStation);
            }

            return null;
        }

        return StaticLayers.FirstOrDefault(candidate =>
            string.Equals(candidate.Provider, provider, StringComparison.OrdinalIgnoreCase)
            && string.Equals(candidate.Layer, layer, StringComparison.OrdinalIgnoreCase));
    }

    private static WmsLayerDefinition CreateLocalRadar(string radarStation)
    {
        var upperStation = radarStation;
        var station = upperStation.ToLowerInvariant();
        return new WmsLayerDefinition(
            $"local-radar-{station}",
            "opengeo",
            $"local-radar-{station}",
            $"{upperStation} Live Radar",
            $"High-resolution base reflectivity for the {upperStation} radar site.",
            $"https://opengeo.ncep.noaa.gov/geoserver/{station}/ows",
            $"{station}_sr_bref",
            "time",
            0.92,
            true,
            "Reflectivity",
            CreateRadarLegend(),
            60);
    }

    private static bool TryRegisterRadarStation(string? station, out string normalizedRadarStation)
    {
        if (!TryNormalizeRadarStation(station, out normalizedRadarStation))
        {
            return false;
        }

        RegisteredRadarStations.TryAdd(normalizedRadarStation, 0);
        return true;
    }

    private static bool TryResolveRegisteredRadarStation(string? station, out string normalizedRadarStation)
    {
        if (!TryNormalizeRadarStation(station, out normalizedRadarStation))
        {
            return false;
        }

        return RegisteredRadarStations.ContainsKey(normalizedRadarStation);
    }

    private static bool TryNormalizeRadarStation(string? station, out string normalizedRadarStation)
    {
        normalizedRadarStation = string.Empty;
        if (string.IsNullOrWhiteSpace(station))
        {
            return false;
        }

        var candidate = station.Trim().ToUpperInvariant();
        if (!RadarStationPattern.IsMatch(candidate))
        {
            return false;
        }

        normalizedRadarStation = candidate;
        return true;
    }

    private static IReadOnlyList<MapLegendEntry> CreateRadarLegend() =>
    [
        new("Light", "#53f0ff"),
        new("Moderate", "#5bff6e"),
        new("Heavy", "#ffe55f"),
        new("Severe", "#ff7a5c"),
        new("Extreme", "#f92f8f")
    ];

    private static IReadOnlyList<MapLegendEntry> CreateHazardsLegend() =>
    [
        new("Watch", "#f1c96b"),
        new("Warning", "#ff6d5a"),
        new("Advisory", "#6ba2ff"),
        new("Statement", "#7df8cb")
    ];

    private static IReadOnlyList<MapLegendEntry> CreateTemperatureLegend() =>
    [
        new("Cold", "#5bc0ff"),
        new("Mild", "#8effd8"),
        new("Warm", "#ffd564"),
        new("Hot", "#ff785a")
    ];

    private static IReadOnlyList<MapLegendEntry> CreateWindLegend() =>
    [
        new("Calm", "#8ef4ff"),
        new("Breezy", "#61d8ff"),
        new("Windy", "#6c96ff"),
        new("Strong", "#b17bff")
    ];

    private static IReadOnlyList<MapLegendEntry> CreateSkyLegend() =>
    [
        new("Clear", "#4de8ff"),
        new("Partly cloudy", "#8dcbff"),
        new("Mostly cloudy", "#4f79d3"),
        new("Overcast", "#30486d")
    ];

    private static IReadOnlyList<MapLegendEntry> CreatePopLegend() =>
    [
        new("Low", "#92f6ff"),
        new("Medium", "#4ba4ff"),
        new("High", "#2854d8"),
        new("Likely", "#8d47ff")
    ];

    private static IReadOnlyList<MapLegendEntry> CreateQpfLegend() =>
    [
        new("Trace", "#8df7ff"),
        new("Light", "#42bbff"),
        new("Moderate", "#466be8"),
        new("Heavy", "#872eff")
    ];
}
