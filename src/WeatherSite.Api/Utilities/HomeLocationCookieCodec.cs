using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;

namespace WeatherSite.Api.Utilities;

public sealed record HomeLocationCookieValue(string Zip, DateTimeOffset SavedAtUtc);

public interface IHomeLocationCookieCodec
{
    string Serialize(string zip, DateTimeOffset savedAtUtc);
    bool TryParse(string? value, out HomeLocationCookieValue? result);
}

public sealed class HomeLocationCookieCodec : IHomeLocationCookieCodec
{
    private const string ProtectorName = "WeatherSite.HomeLocationCookie";
    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);

    private readonly IDataProtector _protector;

    public HomeLocationCookieCodec(IDataProtectionProvider dataProtectionProvider)
    {
        _protector = dataProtectionProvider.CreateProtector(ProtectorName);
    }

    public string Serialize(string zip, DateTimeOffset savedAtUtc)
    {
        var payload = JsonSerializer.Serialize(new HomeLocationCookiePayload(zip, savedAtUtc), SerializerOptions);
        return _protector.Protect(payload);
    }

    public bool TryParse(string? value, out HomeLocationCookieValue? result)
    {
        result = null;
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        try
        {
            var payload = _protector.Unprotect(value);
            var parsed = JsonSerializer.Deserialize<HomeLocationCookiePayload>(payload, SerializerOptions);
            if (parsed is null || string.IsNullOrWhiteSpace(parsed.Zip))
            {
                return false;
            }

            result = new HomeLocationCookieValue(parsed.Zip, parsed.SavedAtUtc);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private sealed record HomeLocationCookiePayload(string Zip, DateTimeOffset SavedAtUtc);
}
