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
[Route("api/session/home-location")]
public sealed class SessionController : ControllerBase
{
    private readonly IHomeLocationCookieCodec _homeLocationCookieCodec;
    private readonly IZipResolver _zipResolver;
    private readonly IResolvedLocationService _resolvedLocationService;
    private readonly IWeatherOverviewService _weatherOverviewService;
    private readonly IMapConfigurationService _mapConfigurationService;
    private readonly TimeProvider _timeProvider;
    private readonly WeatherSiteOptions _options;
    private readonly IHostEnvironment _environment;
    private readonly ServerTimingCollector _timings;

    public SessionController(
        IHomeLocationCookieCodec homeLocationCookieCodec,
        IZipResolver zipResolver,
        IResolvedLocationService resolvedLocationService,
        IWeatherOverviewService weatherOverviewService,
        IMapConfigurationService mapConfigurationService,
        TimeProvider timeProvider,
        IOptions<WeatherSiteOptions> options,
        IHostEnvironment environment,
        ServerTimingCollector timings)
    {
        _homeLocationCookieCodec = homeLocationCookieCodec;
        _zipResolver = zipResolver;
        _resolvedLocationService = resolvedLocationService;
        _weatherOverviewService = weatherOverviewService;
        _mapConfigurationService = mapConfigurationService;
        _timeProvider = timeProvider;
        _options = options.Value;
        _environment = environment;
        _timings = timings;
    }

    [HttpGet]
    [ProducesResponseType<SavedLocationPreference>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<ActionResult<SavedLocationPreference>> GetAsync(CancellationToken cancellationToken)
    {
        if (!_homeLocationCookieCodec.TryParse(Request.Cookies[_options.CookieName], out var cookie)
            || cookie is null
            || !_zipResolver.IsValid(cookie.Zip))
        {
            return NoContent();
        }

        try
        {
            var context = await _resolvedLocationService.GetResolvedLocationAsync(cookie.Zip, cancellationToken);
            return Ok(new SavedLocationPreference(cookie.Zip, context.ToLocationSummary(), cookie.SavedAtUtc));
        }
        catch (ZipResolutionException)
        {
            return NoContent();
        }
    }

    [HttpPost]
    [ProducesResponseType<SaveHomeLocationResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<SaveHomeLocationResponse>> SaveAsync(
        [FromBody] SaveHomeLocationRequest request,
        CancellationToken cancellationToken)
    {
        if (!_zipResolver.IsValid(request.Zip))
        {
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["zip"] = ["ZIP codes must be 5 digits."]
            }));
        }

        try
        {
            var savedAtUtc = _timeProvider.GetUtcNow();
            ResolvedLocationContext context;
            using (_timings.Measure("resolve-location"))
            {
                context = await _resolvedLocationService.GetResolvedLocationAsync(request.Zip, cancellationToken);
            }
            var savedLocation = new SavedLocationPreference(request.Zip, context.ToLocationSummary(), savedAtUtc);
            var overviewTask = _weatherOverviewService.GetOverviewAsync(context, cancellationToken);
            var mapConfigTask = _mapConfigurationService.GetConfigAsync(context, cancellationToken);

            Response.Cookies.Append(
                _options.CookieName,
                _homeLocationCookieCodec.Serialize(request.Zip, savedAtUtc),
                BuildCookieOptions(savedAtUtc));

            var bundleStart = Stopwatch.GetTimestamp();
            await Task.WhenAll(overviewTask, mapConfigTask);
            _timings.Record("bundle-parallel", Stopwatch.GetElapsedTime(bundleStart));

            return Ok(new SaveHomeLocationResponse(
                savedLocation,
                new WeatherBundleResponse(
                    await overviewTask,
                    await mapConfigTask)));
        }
        catch (ZipResolutionException exception)
        {
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["zip"] = [exception.Message]
            }));
        }
    }

    [HttpDelete]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public IActionResult Delete()
    {
        Response.Cookies.Delete(_options.CookieName, new CookieOptions
        {
            Path = "/",
            SameSite = SameSiteMode.Lax,
            Secure = !_environment.IsDevelopment(),
            HttpOnly = true
        });

        return NoContent();
    }

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
}
