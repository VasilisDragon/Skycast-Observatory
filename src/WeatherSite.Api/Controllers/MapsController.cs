using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using WeatherSite.Api.Configuration;
using WeatherSite.Api.Contracts;
using WeatherSite.Api.Services;
using WeatherSite.Api.Utilities;

namespace WeatherSite.Api.Controllers;

[ApiController]
[EnableRateLimiting("weather-api")]
[Route("api/maps")]
public sealed partial class MapsController : ControllerBase
{
    // ISO 8601 instant in UTC, e.g. 2026-04-07T14:05:00Z. The tile cache key
    // embeds this value verbatim, so unbounded shapes let an attacker mint
    // a fresh cache entry per distinct string. Pin to the format every WMS
    // upstream we proxy emits in its capabilities document.
    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$", RegexOptions.CultureInvariant)]
    private static partial Regex TileTimeRegex();

    private readonly IHomeLocationCookieCodec _homeLocationCookieCodec;
    private readonly IMapConfigurationService _mapConfigurationService;
    private readonly IMapTileProxyService _mapTileProxyService;
    private readonly IZipResolver _zipResolver;
    private readonly WeatherSiteOptions _options;

    public MapsController(
        IHomeLocationCookieCodec homeLocationCookieCodec,
        IMapConfigurationService mapConfigurationService,
        IMapTileProxyService mapTileProxyService,
        IZipResolver zipResolver,
        IOptions<WeatherSiteOptions> options)
    {
        _homeLocationCookieCodec = homeLocationCookieCodec;
        _mapConfigurationService = mapConfigurationService;
        _mapTileProxyService = mapTileProxyService;
        _zipResolver = zipResolver;
        _options = options.Value;
    }

    [HttpGet("config")]
    [ProducesResponseType<MapConfigResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<MapConfigResponse>> GetConfigAsync(
        [FromQuery] string? zip,
        CancellationToken cancellationToken)
    {
        var resolvedZip = ResolveZip(zip);
        if (!_zipResolver.IsValid(resolvedZip))
        {
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["zip"] = ["Provide a valid 5-digit ZIP code or save one first."]
            }));
        }

        try
        {
            var config = await _mapConfigurationService.GetConfigAsync(resolvedZip!, cancellationToken);
            return Ok(config);
        }
        catch (ZipResolutionException exception)
        {
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["zip"] = [exception.Message]
            }));
        }
    }

    [HttpGet("tiles/{provider}/{layer}/{z:int}/{x:int}/{y:int}.png")]
    [EnableRateLimiting("tile-proxy")]
    public async Task<IActionResult> GetTileAsync(
        string provider,
        string layer,
        int z,
        int x,
        int y,
        [FromQuery] string? time,
        CancellationToken cancellationToken)
    {
        if (!string.IsNullOrEmpty(time) && !TileTimeRegex().IsMatch(time))
        {
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["time"] = ["Time must be an ISO 8601 UTC instant (e.g. 2026-04-07T14:05:00Z)."]
            }));
        }

        try
        {
            var tile = await _mapTileProxyService.GetTileAsync(provider, layer, z, x, y, time, cancellationToken);
            Response.Headers.CacheControl = $"public,max-age={tile.CacheSeconds}";
            return File(tile.Bytes, tile.ContentType);
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
        catch (ArgumentOutOfRangeException exception)
        {
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["tile"] = [exception.Message]
            }));
        }
        catch (HttpRequestException exception)
        {
            return Problem(
                title: "Map tiles are temporarily unavailable.",
                detail: exception.Message,
                statusCode: StatusCodes.Status502BadGateway);
        }
    }

    private string? ResolveZip(string? zip)
    {
        if (!string.IsNullOrWhiteSpace(zip))
        {
            return zip;
        }

        return _homeLocationCookieCodec.TryParse(Request.Cookies[_options.CookieName], out var cookie)
            ? cookie?.Zip
            : null;
    }
}
