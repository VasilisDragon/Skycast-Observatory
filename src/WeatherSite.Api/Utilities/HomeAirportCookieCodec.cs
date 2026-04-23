using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;

namespace WeatherSite.Api.Utilities;

public sealed record HomeAirportCookieValue(string Icao, DateTimeOffset SavedAtUtc);

public interface IHomeAirportCookieCodec
{
    string Serialize(string icao, DateTimeOffset savedAtUtc);
    bool TryParse(string? value, out HomeAirportCookieValue? result);
}

public sealed class HomeAirportCookieCodec : IHomeAirportCookieCodec
{
    private const string ProtectorName = "WeatherSite.HomeAirportCookie";
    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);

    private readonly IDataProtector _protector;

    public HomeAirportCookieCodec(IDataProtectionProvider dataProtectionProvider)
    {
        _protector = dataProtectionProvider.CreateProtector(ProtectorName);
    }

    public string Serialize(string icao, DateTimeOffset savedAtUtc)
    {
        var payload = JsonSerializer.Serialize(new HomeAirportCookiePayload(icao, savedAtUtc), SerializerOptions);
        return _protector.Protect(payload);
    }

    public bool TryParse(string? value, out HomeAirportCookieValue? result)
    {
        result = null;
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        try
        {
            var payload = _protector.Unprotect(value);
            var parsed = JsonSerializer.Deserialize<HomeAirportCookiePayload>(payload, SerializerOptions);
            if (parsed is null || string.IsNullOrWhiteSpace(parsed.Icao))
            {
                return false;
            }

            result = new HomeAirportCookieValue(parsed.Icao, parsed.SavedAtUtc);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private sealed record HomeAirportCookiePayload(string Icao, DateTimeOffset SavedAtUtc);
}
