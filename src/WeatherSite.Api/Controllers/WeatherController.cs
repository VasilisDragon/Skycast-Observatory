using System.Diagnostics;
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
[EnableRateLimiting("weather-api")]
[Route("api/weather")]
public sealed class WeatherController : ControllerBase
{
    private readonly IHomeLocationCookieCodec _homeLocationCookieCodec;
    private readonly IResolvedLocationService _resolvedLocationService;
    private readonly IWeatherOverviewService _weatherOverviewService;
    private readonly IMapConfigurationService _mapConfigurationService;
    private readonly IZipResolver _zipResolver;
    private readonly WeatherSiteOptions _options;
    private readonly ServerTimingCollector _timings;

    public WeatherController(
        IHomeLocationCookieCodec homeLocationCookieCodec,
        IResolvedLocationService resolvedLocationService,
        IWeatherOverviewService weatherOverviewService,
        IMapConfigurationService mapConfigurationService,
        IZipResolver zipResolver,
        IOptions<WeatherSiteOptions> options,
        ServerTimingCollector timings)
    {
        _homeLocationCookieCodec = homeLocationCookieCodec;
        _resolvedLocationService = resolvedLocationService;
        _weatherOverviewService = weatherOverviewService;
        _mapConfigurationService = mapConfigurationService;
        _zipResolver = zipResolver;
        _options = options.Value;
        _timings = timings;
    }

    [HttpGet("overview")]
    [ProducesResponseType<WeatherOverviewResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<WeatherOverviewResponse>> GetOverviewAsync(
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
            var overview = await _weatherOverviewService.GetOverviewAsync(resolvedZip!, cancellationToken);
            return Ok(overview);
        }
        catch (ZipResolutionException exception)
        {
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["zip"] = [exception.Message]
            }));
        }
    }

    [HttpGet("bundle")]
    [ProducesResponseType<WeatherBundleResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<WeatherBundleResponse>> GetBundleAsync(
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
            ResolvedLocationContext context;
            using (_timings.Measure("resolve-location"))
            {
                context = await _resolvedLocationService.GetResolvedLocationAsync(resolvedZip!, cancellationToken);
            }
            var overviewTask = _weatherOverviewService.GetOverviewAsync(context, cancellationToken);
            var mapConfigTask = _mapConfigurationService.GetConfigAsync(context, cancellationToken);

            var bundleStart = Stopwatch.GetTimestamp();
            await Task.WhenAll(overviewTask, mapConfigTask);
            _timings.Record("bundle-parallel", Stopwatch.GetElapsedTime(bundleStart));

            return Ok(new WeatherBundleResponse(
                await overviewTask,
                await mapConfigTask));
        }
        catch (ZipResolutionException exception)
        {
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["zip"] = [exception.Message]
            }));
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
