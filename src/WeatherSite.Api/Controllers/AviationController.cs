using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using WeatherSite.Api.Configuration;
using WeatherSite.Api.Contracts;
using WeatherSite.Api.Models;
using WeatherSite.Api.Services;
using WeatherSite.Api.Utilities;

namespace WeatherSite.Api.Controllers;

[ApiController]
[Route("api/aviation")]
public sealed class AviationController : ControllerBase
{
    private static readonly TimeSpan MetarStaleThreshold = TimeSpan.FromMinutes(90);
    private const int MaxBatchIds = 60;
    private const int MaxBboxStations = 50;
    private const double DefaultSnapGridDeg = 0.5;

    private readonly IAirportCatalog _airportCatalog;
    private readonly IZipResolver _zipResolver;
    private readonly IAviationWeatherService _awc;
    private readonly IHomeAirportCookieCodec _cookieCodec;
    private readonly TimeProvider _timeProvider;
    private readonly WeatherSiteOptions _options;
    private readonly IHostEnvironment _environment;
    private readonly ILogger<AviationController> _logger;

    public AviationController(
        IAirportCatalog airportCatalog,
        IZipResolver zipResolver,
        IAviationWeatherService awc,
        IHomeAirportCookieCodec cookieCodec,
        TimeProvider timeProvider,
        IOptions<WeatherSiteOptions> options,
        IHostEnvironment environment,
        ILogger<AviationController> logger)
    {
        _airportCatalog = airportCatalog;
        _zipResolver = zipResolver;
        _awc = awc;
        _cookieCodec = cookieCodec;
        _timeProvider = timeProvider;
        _options = options.Value;
        _environment = environment;
        _logger = logger;
    }

    [HttpGet("airports")]
    [EnableRateLimiting("aviation-point")]
    public async Task<ActionResult<AirportSearchResponse>> SearchAsync(
        [FromQuery] string? query,
        [FromQuery] string? anchorZip,
        [FromQuery] string? anchorIcao,
        [FromQuery] int limit = 8,
        CancellationToken cancellationToken = default)
    {
        var safeLimit = Math.Clamp(limit, 1, 25);
        var matches = string.IsNullOrWhiteSpace(query)
            ? Array.Empty<AirportDto>()
            : _airportCatalog.Search(query, safeLimit).Select(ToDto).ToArray();

        IReadOnlyList<AirportWithDistanceDto> nearest = Array.Empty<AirportWithDistanceDto>();
        double? anchorLat = null, anchorLon = null;
        string? anchorExcludeIcao = null;

        if (!string.IsNullOrWhiteSpace(anchorIcao) && _airportCatalog.IsValidIcao(anchorIcao))
        {
            var anchor = _airportCatalog.TryGet(anchorIcao);
            if (anchor is not null)
            {
                anchorLat = anchor.Latitude;
                anchorLon = anchor.Longitude;
                anchorExcludeIcao = anchor.Icao;
            }
        }
        else if (!string.IsNullOrWhiteSpace(anchorZip) && _zipResolver.IsValid(anchorZip))
        {
            try
            {
                var location = await _zipResolver.ResolveAsync(anchorZip, cancellationToken);
                anchorLat = location.Latitude;
                anchorLon = location.Longitude;
            }
            catch (ZipResolutionException)
            {
                anchorLat = null;
            }
        }

        if (anchorLat is not null && anchorLon is not null)
        {
            nearest = _airportCatalog
                .Nearest(anchorLat.Value, anchorLon.Value, safeLimit + (anchorExcludeIcao is null ? 0 : 1))
                .Where(entry => anchorExcludeIcao is null || entry.Airport.Icao != anchorExcludeIcao)
                .Take(safeLimit)
                .Select(entry => new AirportWithDistanceDto(ToDto(entry.Airport), entry.MilesFromOrigin))
                .ToArray();
        }

        return Ok(new AirportSearchResponse(matches, nearest));
    }

    [HttpGet("airports/{icao}")]
    [EnableRateLimiting("aviation-point")]
    public ActionResult<AirportDto> GetAirport(string icao)
    {
        if (!_airportCatalog.IsValidIcao(icao))
        {
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["icao"] = ["ICAO must be a 4-letter code starting with K or P."]
            }));
        }

        var record = _airportCatalog.TryGet(icao);
        return record is null ? NotFound() : Ok(ToDto(record));
    }

    [HttpGet("session/home-airport")]
    [EnableRateLimiting("aviation-point")]
    public ActionResult<SavedAirportPreference> GetSavedAirport()
    {
        if (!_cookieCodec.TryParse(Request.Cookies[_options.AviationCookieName], out var cookie) || cookie is null)
        {
            return NoContent();
        }

        var record = _airportCatalog.TryGet(cookie.Icao);
        if (record is null)
        {
            return NoContent();
        }

        return Ok(new SavedAirportPreference(cookie.Icao, ToDto(record), cookie.SavedAtUtc));
    }

    [HttpPost("session/home-airport")]
    [EnableRateLimiting("aviation-point")]
    public ActionResult<SaveHomeAirportResponse> SaveAirport([FromBody] SaveHomeAirportRequest request)
    {
        var icao = request?.Icao?.Trim().ToUpperInvariant() ?? string.Empty;
        if (!_airportCatalog.IsValidIcao(icao))
        {
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["icao"] = ["ICAO must be a 4-letter code starting with K or P."]
            }));
        }

        var record = _airportCatalog.TryGet(icao);
        if (record is null)
        {
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["icao"] = [$"Airport {icao} is not in the catalog."]
            }));
        }

        var savedAt = _timeProvider.GetUtcNow();
        Response.Cookies.Append(
            _options.AviationCookieName,
            _cookieCodec.Serialize(icao, savedAt),
            BuildCookieOptions(savedAt));

        return Ok(new SaveHomeAirportResponse(new SavedAirportPreference(icao, ToDto(record), savedAt)));
    }

    [HttpDelete("session/home-airport")]
    [EnableRateLimiting("aviation-point")]
    public IActionResult ClearAirport()
    {
        Response.Cookies.Delete(_options.AviationCookieName, new CookieOptions
        {
            Path = "/",
            SameSite = SameSiteMode.Lax,
            Secure = !_environment.IsDevelopment(),
            HttpOnly = true
        });
        return NoContent();
    }

    [HttpGet("metar/{icao}")]
    [EnableRateLimiting("aviation-point")]
    public async Task<ActionResult<MetarResponse>> GetMetarAsync(
        string icao,
        [FromQuery] int hours = 6,
        CancellationToken cancellationToken = default)
    {
        if (!_airportCatalog.IsValidIcao(icao))
        {
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["icao"] = ["ICAO must be a 4-letter code starting with K or P."]
            }));
        }

        var normalized = icao.Trim().ToUpperInvariant();
        var result = await _awc.GetMetarAsync(normalized, hours, cancellationToken);

        if (result.Source is AviationSource.Error && result.Payload is null)
        {
            return Ok(new MetarResponse(normalized, null, Array.Empty<MetarObservationDto>(), ToStatus(result, stale: false)));
        }

        var trend = MetarParser.Parse(result.Payload, _logger);
        var latest = trend.FirstOrDefault();
        var stale = IsMetarStale(latest, result);

        if (result.Source == AviationSource.NoData)
        {
            return Ok(new MetarResponse(normalized, null, Array.Empty<MetarObservationDto>(), ToStatus(result, stale: false)));
        }

        return Ok(new MetarResponse(normalized, latest, trend, ToStatus(result, stale)));
    }

    // Batch METAR — one upstream call for N stations. Tolerates partial
    // failures: missing stations come back as entries with status = "unavailable"
    // rather than a 500 for the whole batch. Consumers (nearby ribbon, bbox
    // stations layer) depend on the graceful-degradation shape.
    [HttpGet("metar")]
    [EnableRateLimiting("aviation-point")]
    public async Task<ActionResult<MetarBatchResponse>> GetMetarBatchAsync(
        [FromQuery] string? ids,
        [FromQuery] int hours = 1,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(ids))
        {
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["ids"] = ["Provide a comma-separated list of ICAO codes."]
            }));
        }

        var requested = ids
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(id => id.ToUpperInvariant())
            .Distinct(StringComparer.Ordinal)
            .Take(MaxBatchIds)
            .ToArray();

        var valid = requested.Where(_airportCatalog.IsValidIcao).ToArray();
        var invalid = requested.Except(valid, StringComparer.Ordinal).ToArray();

        if (valid.Length == 0)
        {
            var unknownEntries = invalid.Select(id => new MetarBatchEntry(id, "invalid", null)).ToArray();
            var emptyStatus = new AviationPanelStatus("no-data", _timeProvider.GetUtcNow(), false, false, null);
            return Ok(new MetarBatchResponse(unknownEntries, emptyStatus));
        }

        var result = await _awc.GetMetarBatchAsync(valid, hours, cancellationToken);
        var observations = MetarParser.Parse(result.Payload, _logger);
        var byIcao = observations
            .Where(o => !string.IsNullOrWhiteSpace(o.Icao))
            .GroupBy(o => o.Icao, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

        // Preserve request order in the response so clients don't have to
        // re-sort. Invalid ICAOs sort to the end under "invalid" status.
        var entries = requested
            .Select(id =>
            {
                if (!valid.Contains(id, StringComparer.Ordinal))
                {
                    return new MetarBatchEntry(id, "invalid", null);
                }
                if (byIcao.TryGetValue(id, out var obs))
                {
                    return new MetarBatchEntry(id, "ok", obs);
                }
                return new MetarBatchEntry(id, "unavailable", null);
            })
            .ToArray();

        var stale = result.Source is AviationSource.StaleCache;
        return Ok(new MetarBatchResponse(entries, ToStatus(result, stale)));
    }

    // Bbox-stations for the Phase C map overlay. Snaps the bbox to a fixed
    // grid (default 0.5° — approx 55 km N-S and 40 km E-W at 40°N) so adjacent
    // pans hit the same cache key upstream. Caps at 50 stations per response
    // and flags truncation so the client can prompt "zoom in for all stations".
    [HttpGet("stations/bbox")]
    [EnableRateLimiting("aviation-point")]
    public async Task<ActionResult<StationsBboxResponse>> GetStationsInBboxAsync(
        [FromQuery] double w,
        [FromQuery] double s,
        [FromQuery] double e,
        [FromQuery] double n,
        [FromQuery] double? snap = null,
        [FromQuery] int limit = MaxBboxStations,
        CancellationToken cancellationToken = default)
    {
        var errors = new Dictionary<string, string[]>();
        if (s < -90 || s > 90 || n < -90 || n > 90)
        {
            errors["s"] = ["Latitude bounds must be in [-90, 90]."];
        }
        if (w < -180 || w > 180 || e < -180 || e > 180)
        {
            errors["w"] = ["Longitude bounds must be in [-180, 180]."];
        }
        if (errors.Count > 0)
        {
            return ValidationProblem(new ValidationProblemDetails(errors));
        }

        var grid = snap is > 0 ? Math.Clamp(snap.Value, 0.05, 5.0) : DefaultSnapGridDeg;
        var snapped = SnapBbox(w, s, e, n, grid);
        var safeLimit = Math.Clamp(limit, 1, MaxBboxStations);

        var bbox = _airportCatalog.InBbox(snapped.West, snapped.South, snapped.East, snapped.North, safeLimit);
        if (bbox.Stations.Count == 0)
        {
            var emptyStatus = new AviationPanelStatus("no-data", _timeProvider.GetUtcNow(), false, false, null);
            return Ok(new StationsBboxResponse(
                Array.Empty<StationsBboxEntry>(),
                bbox.TotalInBbox,
                bbox.Truncated,
                snapped.West, snapped.South, snapped.East, snapped.North,
                emptyStatus));
        }

        var icaos = bbox.Stations.Select(r => r.Icao).ToArray();
        var result = await _awc.GetMetarBatchAsync(icaos, 1, cancellationToken);
        var observations = MetarParser.Parse(result.Payload, _logger);
        var byIcao = observations
            .Where(o => !string.IsNullOrWhiteSpace(o.Icao))
            .GroupBy(o => o.Icao, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

        var entries = bbox.Stations
            .Select(r =>
            {
                var airport = ToDto(r);
                if (byIcao.TryGetValue(r.Icao, out var obs))
                {
                    return new StationsBboxEntry(airport, "ok", obs);
                }
                return new StationsBboxEntry(airport, "unavailable", null);
            })
            .ToArray();

        var stale = result.Source is AviationSource.StaleCache;
        return Ok(new StationsBboxResponse(
            entries,
            bbox.TotalInBbox,
            bbox.Truncated,
            snapped.West, snapped.South, snapped.East, snapped.North,
            ToStatus(result, stale)));
    }

    private readonly record struct SnappedBbox(double West, double South, double East, double North);

    private static SnappedBbox SnapBbox(double west, double south, double east, double north, double grid)
    {
        // Round outward: west/south floor, east/north ceiling. That way the
        // snapped bbox always covers the original request, so the returned
        // stations never miss a station the client can see.
        var snappedW = Math.Floor(west / grid) * grid;
        var snappedS = Math.Floor(south / grid) * grid;
        var snappedE = Math.Ceiling(east / grid) * grid;
        var snappedN = Math.Ceiling(north / grid) * grid;
        return new SnappedBbox(
            Math.Clamp(snappedW, -180.0, 180.0),
            Math.Clamp(snappedS, -90.0, 90.0),
            Math.Clamp(snappedE, -180.0, 180.0),
            Math.Clamp(snappedN, -90.0, 90.0));
    }

    [HttpGet("taf/{icao}")]
    [EnableRateLimiting("aviation-point")]
    public async Task<ActionResult<TafResponse>> GetTafAsync(string icao, CancellationToken cancellationToken = default)
    {
        if (!_airportCatalog.IsValidIcao(icao))
        {
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["icao"] = ["ICAO must be a 4-letter code starting with K or P."]
            }));
        }

        var normalized = icao.Trim().ToUpperInvariant();
        var result = await _awc.GetTafAsync(normalized, cancellationToken);

        if (result.Source == AviationSource.NoData)
        {
            return Ok(new TafResponse(normalized, null, ToStatus(result, stale: false)));
        }

        if (result.Source is AviationSource.Error && result.Payload is null)
        {
            return Ok(new TafResponse(normalized, null, ToStatus(result, stale: false)));
        }

        var report = TafParser.Parse(result.Payload, _logger);
        var stale = IsTafStale(report, result);
        return Ok(new TafResponse(normalized, report, ToStatus(result, stale)));
    }

    [HttpGet("hazards/{kind}")]
    [EnableRateLimiting("aviation-poly")]
    public async Task<ActionResult<HazardsResponse>> GetHazardsAsync(string kind, CancellationToken cancellationToken = default)
    {
        var normalizedKind = (kind ?? "airmet").Trim().ToLowerInvariant();
        var result = await _awc.GetHazardsAsync(normalizedKind, cancellationToken);
        var features = ParseHazardFeatures(result.Payload, normalizedKind).ToArray();
        var stale = result.Source is AviationSource.StaleCache;
        return Ok(new HazardsResponse(normalizedKind, features, ToStatus(result, stale)));
    }

    [HttpGet("pireps")]
    [EnableRateLimiting("aviation-point")]
    public async Task<ActionResult<PirepsResponse>> GetPirepsAsync(
        [FromQuery] double lat,
        [FromQuery] double lon,
        [FromQuery] int radius = 200,
        CancellationToken cancellationToken = default)
    {
        var result = await _awc.GetPirepsAsync(lat, lon, radius, cancellationToken);
        var features = ParsePirepFeatures(result.Payload).ToArray();
        var stale = result.Source is AviationSource.StaleCache;
        return Ok(new PirepsResponse(features, ToStatus(result, stale)));
    }

    [HttpGet("winds-aloft")]
    [EnableRateLimiting("aviation-poly")]
    public async Task<ActionResult<WindsAloftResponse>> GetWindsAloftAsync(
        [FromQuery] string region = "us",
        CancellationToken cancellationToken = default)
    {
        var result = await _awc.GetWindsAloftAsync(region, cancellationToken);
        var (stations, validFrom, validTo) = FbParser.Parse(result.Payload, _logger);
        var stale = result.Source is AviationSource.StaleCache;
        return Ok(new WindsAloftResponse(region, validFrom, validTo, stations, ToStatus(result, stale)));
    }

    private bool IsMetarStale(MetarObservationDto? latest, AviationFetchResult result)
    {
        if (result.Source is AviationSource.StaleCache)
        {
            return true;
        }
        if (latest?.ObservedAtUtc is null)
        {
            return false;
        }
        return _timeProvider.GetUtcNow() - latest.ObservedAtUtc.Value > MetarStaleThreshold;
    }

    private bool IsTafStale(TafReportDto? report, AviationFetchResult result)
    {
        if (result.Source is AviationSource.StaleCache)
        {
            return true;
        }
        if (report?.ValidToUtc is null)
        {
            return false;
        }
        return _timeProvider.GetUtcNow() > report.ValidToUtc.Value;
    }

    private static AviationPanelStatus ToStatus(AviationFetchResult result, bool stale)
    {
        var sourceLabel = result.Source switch
        {
            AviationSource.Live => "live",
            AviationSource.Cache => "cache",
            AviationSource.StaleCache => "stale",
            AviationSource.NoData => "no-data",
            _ => "error"
        };
        return new AviationPanelStatus(sourceLabel, result.FetchedAtUtc, result.Throttled, stale, result.ErrorMessage);
    }

    private static AirportDto ToDto(AirportRecord record) =>
        new(record.Icao, record.Name, record.City, record.State, record.Latitude, record.Longitude, record.ElevationFt);

    private CookieOptions BuildCookieOptions(DateTimeOffset savedAtUtc) =>
        new()
        {
            Expires = savedAtUtc.AddDays(_options.CookieLifetimeDays),
            HttpOnly = true,
            IsEssential = true,
            Path = "/",
            SameSite = SameSiteMode.Lax,
            Secure = !_environment.IsDevelopment()
        };

    private IEnumerable<HazardFeatureDto> ParseHazardFeatures(string? payload, string kind)
    {
        if (string.IsNullOrWhiteSpace(payload))
        {
            yield break;
        }

        JsonNode? root;
        try
        {
            root = JsonNode.Parse(payload);
        }
        catch (JsonException exception)
        {
            _logger.LogWarning(exception, "Hazard parser drift for kind={Kind}.", kind);
            yield break;
        }

        var array = root as JsonArray ?? root?["data"] as JsonArray;
        if (array is null)
        {
            yield break;
        }

        foreach (var entry in array)
        {
            if (entry is null)
            {
                continue;
            }

            var id = entry.GetString("airSigmetId")
                ?? entry.GetString("cwaId")
                ?? entry.GetString("id")
                ?? Guid.NewGuid().ToString("N");
            var polygon = ParsePolygon(entry["coords"] as JsonArray).ToArray();
            yield return new HazardFeatureDto(
                id,
                kind.ToUpperInvariant(),
                entry.GetString("hazard"),
                entry.GetString("severity"),
                ParseInstant(entry, "validTimeFrom"),
                ParseInstant(entry, "validTimeTo"),
                entry.GetString("rawAirSigmet") ?? entry.GetString("rawCwa") ?? entry.GetString("raw"),
                polygon);
        }
    }

    private static IEnumerable<IReadOnlyList<double>> ParsePolygon(JsonArray? coords)
    {
        if (coords is null)
        {
            yield break;
        }

        foreach (var point in coords)
        {
            var lat = point.GetDouble("lat");
            var lon = point.GetDouble("lon");
            if (lat is null || lon is null)
            {
                continue;
            }
            yield return new[] { lat.Value, lon.Value };
        }
    }

    private IEnumerable<PirepPointDto> ParsePirepFeatures(string? payload)
    {
        if (string.IsNullOrWhiteSpace(payload))
        {
            yield break;
        }

        JsonNode? root;
        try
        {
            root = JsonNode.Parse(payload);
        }
        catch (JsonException exception)
        {
            _logger.LogWarning(exception, "PIREP parser drift.");
            yield break;
        }

        var array = root as JsonArray ?? root?["data"] as JsonArray;
        if (array is null)
        {
            yield break;
        }

        foreach (var entry in array)
        {
            if (entry is null)
            {
                continue;
            }

            var lat = entry.GetDouble("lat");
            var lon = entry.GetDouble("lon");
            if (lat is null || lon is null)
            {
                continue;
            }

            yield return new PirepPointDto(
                entry.GetString("pirepId") ?? Guid.NewGuid().ToString("N"),
                lat.Value,
                lon.Value,
                ParseInstant(entry, "obsTime"),
                entry.GetInt("fltLvl"),
                entry.GetString("acType"),
                entry.GetString("rawOb"),
                entry.GetString("turbInt1"),
                entry.GetString("icgInt1"));
        }
    }

    private static DateTimeOffset? ParseInstant(JsonNode node, string propertyName)
    {
        var child = node[propertyName];
        if (child is null)
        {
            return null;
        }

        var numeric = child.AsDouble();
        if (numeric is not null && numeric.Value > 1_000_000_000d)
        {
            return DateTimeOffset.FromUnixTimeSeconds((long)numeric.Value);
        }

        var text = child.AsString();
        if (!string.IsNullOrWhiteSpace(text)
            && DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var dto))
        {
            return dto.ToUniversalTime();
        }
        return null;
    }
}
