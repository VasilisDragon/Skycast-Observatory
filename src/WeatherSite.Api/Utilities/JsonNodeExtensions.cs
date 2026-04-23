using System.Globalization;
using System.Text.Json.Nodes;

namespace WeatherSite.Api.Utilities;

public static class JsonNodeExtensions
{
    public static string? AsString(this JsonNode? node)
    {
        if (node is null)
        {
            return null;
        }

        try
        {
            return node.GetValue<string>();
        }
        catch
        {
            return node.ToJsonString().Trim('"');
        }
    }

    public static double? AsDouble(this JsonNode? node)
    {
        if (node is null)
        {
            return null;
        }

        try
        {
            return node.GetValue<double>();
        }
        catch
        {
            var text = node.AsString();
            return double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var value)
                ? value
                : null;
        }
    }

    public static int? AsInt(this JsonNode? node)
    {
        var value = node.AsDouble();
        return value is null ? null : Convert.ToInt32(Math.Round(value.Value, MidpointRounding.AwayFromZero));
    }

    public static DateTimeOffset? AsDateTimeOffset(this JsonNode? node)
    {
        var text = node.AsString();
        return DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var value)
            ? value
            : null;
    }

    public static JsonObject? AsObject(this JsonNode? node) => node as JsonObject;

    public static JsonArray? AsArray(this JsonNode? node) => node as JsonArray;

    public static string? GetString(this JsonNode? node, string propertyName) => node?[propertyName].AsString();

    public static double? GetDouble(this JsonNode? node, string propertyName) => node?[propertyName].AsDouble();

    public static int? GetInt(this JsonNode? node, string propertyName) => node?[propertyName].AsInt();

    public static DateTimeOffset? GetDateTimeOffset(this JsonNode? node, string propertyName) => node?[propertyName].AsDateTimeOffset();

    public static JsonObject? GetObject(this JsonNode? node, string propertyName)
    {
        if (node is null)
        {
            return null;
        }

        var child = node[propertyName];
        return child as JsonObject;
    }

    public static JsonArray? GetArray(this JsonNode? node, string propertyName)
    {
        if (node is null)
        {
            return null;
        }

        var child = node[propertyName];
        return child as JsonArray;
    }
}
