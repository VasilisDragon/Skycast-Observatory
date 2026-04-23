using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;

namespace WeatherSite.Api.Tests;

internal sealed class TestWebHostEnvironment : IWebHostEnvironment
{
    public TestWebHostEnvironment(string contentRootPath)
    {
        ApplicationName = "WeatherSite.Api.Tests";
        ContentRootPath = contentRootPath;
        ContentRootFileProvider = new NullFileProvider();
        EnvironmentName = "Development";
        WebRootPath = Path.Combine(contentRootPath, "wwwroot");
        WebRootFileProvider = new NullFileProvider();
    }

    public string ApplicationName { get; set; }

    public IFileProvider ContentRootFileProvider { get; set; }

    public string ContentRootPath { get; set; }

    public string EnvironmentName { get; set; }

    public string WebRootPath { get; set; }

    public IFileProvider WebRootFileProvider { get; set; }
}

internal sealed class StubHttpClientFactory(HttpClient client) : IHttpClientFactory
{
    public HttpClient CreateClient(string name) => client;
}

internal sealed class StubHttpMessageHandler(Func<HttpRequestMessage, HttpResponseMessage> handler) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
        Task.FromResult(handler(request));
}
