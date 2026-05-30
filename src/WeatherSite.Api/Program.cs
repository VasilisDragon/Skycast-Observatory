using System.IO.Compression;
using System.Net;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.Extensions.Options;
using WeatherSite.Api.Configuration;
using WeatherSite.Api.Services;
using WeatherSite.Api.Utilities;
using Microsoft.Extensions.Primitives;

var builder = WebApplication.CreateBuilder(args);
var trustedTunnelProxyAddress = IPAddress.Parse("192.168.1.102");
var weatherSiteConfiguration = builder.Configuration.GetSection(WeatherSiteOptions.SectionName);
var dataProtectionKeysPath = weatherSiteConfiguration.GetValue<string>(nameof(WeatherSiteOptions.DataProtectionKeysPath))
    ?? "App_Data/DataProtectionKeys";
var apiRequestsPerMinute = weatherSiteConfiguration.GetValue<int?>(nameof(WeatherSiteOptions.ApiRequestsPerMinute)) ?? 120;
var tileRequestsPerMinute = weatherSiteConfiguration.GetValue<int?>(nameof(WeatherSiteOptions.TileRequestsPerMinute)) ?? 600;
var aviationPointRequestsPerMinute = weatherSiteConfiguration.GetValue<int?>(nameof(WeatherSiteOptions.AviationPointRequestsPerMinute)) ?? 120;
var aviationPolyRequestsPerMinute = weatherSiteConfiguration.GetValue<int?>(nameof(WeatherSiteOptions.AviationPolyRequestsPerMinute)) ?? 30;
var memoryCacheSizeKb = weatherSiteConfiguration.GetValue<int?>(nameof(WeatherSiteOptions.MemoryCacheSizeKb)) ?? 256 * 1024;
var fullDataProtectionKeysPath = Path.Combine(builder.Environment.ContentRootPath, dataProtectionKeysPath);

Directory.CreateDirectory(fullDataProtectionKeysPath);

builder.Services.AddControllers();
builder.Services.AddOpenApi();
builder.Services.AddProblemDetails();
builder.Services.AddMemoryCache(options =>
{
    // Cap total cache payload — bounds the chained DEF-006/DEF-007 memory
    // pollution primitive (attacker-controlled tile cache keys). Every
    // _cache.Set in this app passes a Size estimate; if a future Set is
    // added without one, that entry is treated as size 0 and the cap stops
    // engaging for the cache as a whole, so keep Sizes in sync.
    options.SizeLimit = memoryCacheSizeKb;
});
var dataProtectionBuilder = builder.Services.AddDataProtection()
    .SetApplicationName("WeatherSite")
    .PersistKeysToFileSystem(new DirectoryInfo(fullDataProtectionKeysPath));

if (OperatingSystem.IsWindows())
{
    // Wrap the persisted key files with the local machine's DPAPI so an
    // off-box copy of the key directory is unusable. Single-host IIS
    // deployment, so machine-scoped DPAPI is correct; switch to a cert
    // (ProtectKeysWithCertificate) only if scaling to multiple hosts.
    dataProtectionBuilder.ProtectKeysWithDpapi(protectToLocalMachine: true);
}
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddOptions<WeatherSiteOptions>()
    .Bind(weatherSiteConfiguration)
    .ValidateDataAnnotations()
    .ValidateOnStart();
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders =
        ForwardedHeaders.XForwardedFor
        | ForwardedHeaders.XForwardedHost
        | ForwardedHeaders.XForwardedProto;

    // The Cloudflare tunnel runs on a separate Docker host on the LAN and
    // forwards to IIS:8080. Trust only that host's address when reading
    // X-Forwarded-* headers; without this pin, ASP.NET Core's default
    // restricts trust to 127.0.0.1 and silently drops the headers from
    // any non-loopback proxy, leaving Request.IsHttps=false and the
    // rate-limit partition keyed on the tunnel IP.
    options.KnownProxies.Add(trustedTunnelProxyAddress);
    options.ForwardLimit = 1;
});
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.OnRejected = (context, cancellationToken) =>
    {
        if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
        {
            context.HttpContext.Response.Headers.RetryAfter = Math.Max(1, (int)Math.Ceiling(retryAfter.TotalSeconds)).ToString();
        }

        return ValueTask.CompletedTask;
    };
    options.AddPolicy("weather-api", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: ClientAddressResolver.GetClientAddress(httpContext, trustedTunnelProxyAddress),
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = apiRequestsPerMinute,
                QueueLimit = 0,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                Window = TimeSpan.FromMinutes(1)
            }));
    options.AddPolicy("tile-proxy", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: ClientAddressResolver.GetClientAddress(httpContext, trustedTunnelProxyAddress),
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = tileRequestsPerMinute,
                QueueLimit = 0,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                Window = TimeSpan.FromMinutes(1)
            }));
    options.AddPolicy("aviation-point", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: ClientAddressResolver.GetClientAddress(httpContext, trustedTunnelProxyAddress),
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = aviationPointRequestsPerMinute,
                QueueLimit = 0,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                Window = TimeSpan.FromMinutes(1)
            }));
    options.AddPolicy("aviation-poly", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: ClientAddressResolver.GetClientAddress(httpContext, trustedTunnelProxyAddress),
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = aviationPolyRequestsPerMinute,
                QueueLimit = 0,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                Window = TimeSpan.FromMinutes(1)
            }));
});
builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.Providers.Add<BrotliCompressionProvider>();
    options.Providers.Add<GzipCompressionProvider>();
});
builder.Services.AddHsts(options =>
{
    options.MaxAge = TimeSpan.FromDays(180);
    options.IncludeSubDomains = true;
});
builder.Services.Configure<BrotliCompressionProviderOptions>(options => options.Level = CompressionLevel.Fastest);
builder.Services.Configure<GzipCompressionProviderOptions>(options => options.Level = CompressionLevel.Fastest);

builder.Services.AddHttpClient("weather-site:generic")
    .ConfigureHttpClient((serviceProvider, client) =>
    {
        var options = serviceProvider.GetRequiredService<IOptions<WeatherSiteOptions>>().Value;
        client.DefaultRequestHeaders.UserAgent.ParseAdd(options.UserAgent);
        client.Timeout = TimeSpan.FromSeconds(20);
    });

builder.Services.AddHttpClient("weather-site:nws", client =>
    {
        client.BaseAddress = new Uri("https://api.weather.gov/");
        client.Timeout = TimeSpan.FromSeconds(20);
    })
    .ConfigureHttpClient((serviceProvider, client) =>
    {
        var options = serviceProvider.GetRequiredService<IOptions<WeatherSiteOptions>>().Value;
        client.DefaultRequestHeaders.UserAgent.ParseAdd(options.UserAgent);
    });

builder.Services.AddHttpClient("weather-site:awc", client =>
    {
        client.BaseAddress = new Uri("https://aviationweather.gov/api/data/");
        client.Timeout = TimeSpan.FromSeconds(10);
    })
    .ConfigureHttpClient((serviceProvider, client) =>
    {
        var options = serviceProvider.GetRequiredService<IOptions<WeatherSiteOptions>>().Value;
        client.DefaultRequestHeaders.UserAgent.ParseAdd(options.UserAgent);
    });

builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ServerTimingCollector>();
builder.Services.AddSingleton<IZipResolver, ZipResolver>();
builder.Services.AddSingleton<IHomeLocationCookieCodec, HomeLocationCookieCodec>();
builder.Services.AddSingleton<IMapTileProxyService, MapTileProxyService>();
builder.Services.AddSingleton<IMapConfigurationService, MapConfigurationService>();
builder.Services.AddSingleton<IResolvedLocationService, NwsWeatherService>();
builder.Services.AddSingleton<IWeatherOverviewService, NwsWeatherService>();
builder.Services.AddSingleton<IAirportCatalog, AirportCatalog>();
builder.Services.AddSingleton<IAviationWeatherService, AviationWeatherService>();
builder.Services.AddSingleton<IHomeAirportCookieCodec, HomeAirportCookieCodec>();

var app = builder.Build();
var weatherSiteOptions = app.Services.GetRequiredService<IOptions<WeatherSiteOptions>>().Value;
var staticFileContentTypes = new FileExtensionContentTypeProvider();
staticFileContentTypes.Mappings[".pmtiles"] = "application/octet-stream";

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}
else
{
    app.UseExceptionHandler();
}

if (weatherSiteOptions.UseForwardedHeaders)
{
    app.UseForwardedHeaders();
}

if (app.Environment.IsDevelopment())
{
    // Server-Timing leaks per-phase upstream names, cache hit/miss state,
    // and precise internal latencies. Useful in dev for performance work,
    // unnecessary on the public internet — silence in non-dev environments.
    app.Use(async (context, next) =>
    {
        var timings = context.RequestServices.GetRequiredService<ServerTimingCollector>();
        context.Response.OnStarting(() =>
        {
            context.Response.Headers["Server-Timing"] = new StringValues(timings.Format());
            return Task.CompletedTask;
        });
        await next();
    });
}

app.Use(async (context, next) =>
{
    context.Response.OnStarting(() =>
    {
        var headers = context.Response.Headers;
        headers["Content-Security-Policy"] =
            "default-src 'self'; " +
            "base-uri 'self'; " +
            "object-src 'none'; " +
            "frame-ancestors 'none'; " +
            "form-action 'self'; " +
            "script-src 'self'; " +
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
            "img-src 'self' data: https:; " +
            "font-src 'self' data: https://fonts.gstatic.com https://protomaps.github.io; " +
            "connect-src 'self'; " +
            "worker-src 'self' blob:; " +
            "upgrade-insecure-requests";
        headers["Permissions-Policy"] = "camera=(), geolocation=(), microphone=()";
        headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
        headers["X-Content-Type-Options"] = "nosniff";
        headers["X-Frame-Options"] = "DENY";
        headers["Cross-Origin-Opener-Policy"] = "same-origin";
        return Task.CompletedTask;
    });

    await next();
});

app.UseResponseCompression();
if (weatherSiteOptions.EnforceHttpsRedirection)
{
    app.UseHsts();
    app.UseHttpsRedirection();
}
app.UseRateLimiter();
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = staticFileContentTypes,
    OnPrepareResponse = ctx =>
    {
        var path = ctx.Context.Request.Path.Value ?? string.Empty;
        var fileName = ctx.File?.Name ?? string.Empty;
        var headers = ctx.Context.Response.Headers;

        if (path.StartsWith("/assets/", StringComparison.OrdinalIgnoreCase))
        {
            headers["Cache-Control"] = "public, max-age=31536000, immutable";
        }
        else if (fileName.EndsWith(".html", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith(".html", StringComparison.OrdinalIgnoreCase)
            || path == "/" || path.Length == 0)
        {
            headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
            headers["Pragma"] = "no-cache";
            headers["Expires"] = "0";
        }
        else
        {
            headers["Cache-Control"] = "public, max-age=3600";
        }
    }
});

app.Use(async (context, next) =>
{
    var path = context.Request.Path.Value;
    if (path is not null && path.StartsWith("/assets/", StringComparison.OrdinalIgnoreCase))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }
    await next();
});

app.UseAuthorization();

app.MapControllers();
app.MapFallback(async context =>
{
    var headers = context.Response.Headers;
    headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
    headers["Pragma"] = "no-cache";
    headers["Expires"] = "0";
    context.Response.ContentType = "text/html; charset=utf-8";
    var indexPath = Path.Combine(app.Environment.WebRootPath, "index.html");
    await context.Response.SendFileAsync(indexPath);
});

app.Run();

public partial class Program;
