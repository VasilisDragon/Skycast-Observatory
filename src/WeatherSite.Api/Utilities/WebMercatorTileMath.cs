namespace WeatherSite.Api.Utilities;

public static class WebMercatorTileMath
{
    private const double EarthRadius = 6378137d;
    private const double OriginShift = Math.PI * EarthRadius;
    private const int TileSize = 256;

    public static string GetBoundingBox(int z, int x, int y)
    {
        var resolution = (2d * OriginShift) / (TileSize * Math.Pow(2d, z));

        var minX = (x * TileSize * resolution) - OriginShift;
        var maxX = ((x + 1) * TileSize * resolution) - OriginShift;
        var maxY = OriginShift - (y * TileSize * resolution);
        var minY = OriginShift - ((y + 1) * TileSize * resolution);

        return $"{minX},{minY},{maxX},{maxY}";
    }
}
