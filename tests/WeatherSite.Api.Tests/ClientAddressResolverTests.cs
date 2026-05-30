using System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Primitives;
using WeatherSite.Api.Utilities;

namespace WeatherSite.Api.Tests;

public sealed class ClientAddressResolverTests
{
    private static readonly IPAddress TrustedProxy = IPAddress.Parse("192.168.1.102");

    [Fact]
    public void GetClientAddress_UsesCfConnectingIp_WhenRemoteAddressIsTrustedProxy()
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = TrustedProxy;
        context.Request.Headers["CF-Connecting-IP"] = "203.0.113.10";

        var address = ClientAddressResolver.GetClientAddress(context, TrustedProxy);

        Assert.Equal("203.0.113.10", address);
    }

    [Fact]
    public void GetClientAddress_IgnoresCfConnectingIp_WhenRemoteAddressIsNotTrustedProxy()
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = IPAddress.Parse("198.51.100.7");
        context.Request.Headers["CF-Connecting-IP"] = "203.0.113.10";

        var address = ClientAddressResolver.GetClientAddress(context, TrustedProxy);

        Assert.Equal("198.51.100.7", address);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-an-ip")]
    [InlineData("203.0.113.10, 203.0.113.11")]
    public void TryParseSingleIpAddress_RejectsInvalidOrChainedValues(string value)
    {
        var parsed = ClientAddressResolver.TryParseSingleIpAddress(new StringValues(value), out _);

        Assert.False(parsed);
    }
}
