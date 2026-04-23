using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace WeatherSite.Api.Utilities;

/// <summary>
/// Scoped per-request collector that records phase durations and
/// formats them as a W3C Server-Timing response header.
/// Used only for hydration-chain diagnostics (Item 2 of Phase 3).
/// </summary>
public sealed class ServerTimingCollector
{
    private readonly ConcurrentQueue<Entry> _entries = new();
    private readonly Stopwatch _requestStopwatch = Stopwatch.StartNew();

    public IDisposable Measure(string name)
    {
        var stopwatch = Stopwatch.StartNew();
        return new Scope(this, name, stopwatch);
    }

    public void Record(string name, TimeSpan duration, string? resolutionSource = null)
    {
        _entries.Enqueue(new Entry(name, duration, resolutionSource));
    }

    public void RecordCacheSource(string name, string source)
    {
        _entries.Enqueue(new Entry(name, TimeSpan.Zero, source));
    }

    public string Format()
    {
        _requestStopwatch.Stop();
        var builder = new StringBuilder();
        var first = true;

        foreach (var entry in _entries)
        {
            if (!first)
            {
                builder.Append(", ");
            }
            first = false;
            builder.Append(entry.Name);

            if (entry.ResolutionSource is not null)
            {
                builder.Append(";desc=\"").Append(entry.ResolutionSource).Append('"');
            }

            if (entry.Duration > TimeSpan.Zero || entry.ResolutionSource is null)
            {
                builder.Append(";dur=").Append(entry.Duration.TotalMilliseconds.ToString("0.##", CultureInfo.InvariantCulture));
            }
        }

        if (!first)
        {
            builder.Append(", ");
        }
        builder.Append("total;dur=").Append(_requestStopwatch.Elapsed.TotalMilliseconds.ToString("0.##", CultureInfo.InvariantCulture));

        return builder.ToString();
    }

    private sealed record Entry(string Name, TimeSpan Duration, string? ResolutionSource);

    private sealed class Scope : IDisposable
    {
        private readonly ServerTimingCollector _collector;
        private readonly string _name;
        private readonly Stopwatch _stopwatch;
        private bool _disposed;

        public Scope(ServerTimingCollector collector, string name, Stopwatch stopwatch)
        {
            _collector = collector;
            _name = name;
            _stopwatch = stopwatch;
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }
            _disposed = true;
            _stopwatch.Stop();
            _collector.Record(_name, _stopwatch.Elapsed);
        }
    }
}
