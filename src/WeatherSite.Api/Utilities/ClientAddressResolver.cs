using System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Primitives;

namespace WeatherSite.Api.Utilities;

public static class ClientAddressResolver
{
    public static string GetClientAddress(HttpContext context, IPAddress trustedProxyAddress)
    {
        var remoteAddress = Normalize(context.Connection.RemoteIpAddress);
        if (IsTrustedProxy(remoteAddress, trustedProxyAddress)
            && TryParseSingleIpAddress(context.Request.Headers["CF-Connecting-IP"], out var cfConnectingIp))
        {
            return cfConnectingIp.ToString();
        }

        return remoteAddress?.ToString() ?? "unknown";
    }

    public static bool IsTrustedProxy(IPAddress? remoteAddress, IPAddress trustedProxyAddress)
    {
        var normalizedRemote = Normalize(remoteAddress);
        var normalizedTrusted = Normalize(trustedProxyAddress);
        return normalizedRemote is not null && normalizedRemote.Equals(normalizedTrusted);
    }

    public static bool TryParseSingleIpAddress(StringValues values, out IPAddress address)
    {
        address = IPAddress.None;
        if (StringValues.IsNullOrEmpty(values) || values.Count != 1)
        {
            return false;
        }

        var candidate = values[0]?.Trim();
        if (string.IsNullOrEmpty(candidate) || candidate.Contains(',', StringComparison.Ordinal))
        {
            return false;
        }

        if (!IPAddress.TryParse(candidate, out var parsed))
        {
            return false;
        }

        address = Normalize(parsed)!;
        return true;
    }

    private static IPAddress? Normalize(IPAddress? address) =>
        address?.IsIPv4MappedToIPv6 == true ? address.MapToIPv4() : address;
}
