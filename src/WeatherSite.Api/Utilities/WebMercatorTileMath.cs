namespace WeatherSite.Api.Utilities;

public static class WebMercatorTileMath
{
    private const double EarthRadius = 6378137d;
    private const double OriginShift = Math.PI * EarthRadius;
    private const int TileSize = 256;
    public const int MaxTileZoom = 18;

    public static string GetBoundingBox(int z, int x, int y)
    {
        ValidateTileCoordinates(z, x, y);

        var resolution = (2d * OriginShift) / (TileSize * Math.Pow(2d, z));

        var minX = (x * TileSize * resolution) - OriginShift;
        var maxX = ((x + 1) * TileSize * resolution) - OriginShift;
        var maxY = OriginShift - (y * TileSize * resolution);
        var minY = OriginShift - ((y + 1) * TileSize * resolution);

        return $"{minX},{minY},{maxX},{maxY}";
    }

    public static void ValidateTileCoordinates(int z, int x, int y)
    {
        if (z < 0 || z > MaxTileZoom)
        {
            throw new ArgumentOutOfRangeException(nameof(z), $"Tile zoom must be between 0 and {MaxTileZoom}.");
        }

        var tileCount = 1 << z;
        if (x < 0 || x >= tileCount)
        {
            throw new ArgumentOutOfRangeException(nameof(x), $"Tile x must be between 0 and {tileCount - 1} for zoom {z}.");
        }

        if (y < 0 || y >= tileCount)
        {
            throw new ArgumentOutOfRangeException(nameof(y), $"Tile y must be between 0 and {tileCount - 1} for zoom {z}.");
        }
    }
}
