namespace WeatherSite.Api.Utilities;

public enum FlightCategory
{
    Unknown = 0,
    Lifr = 1,
    Ifr = 2,
    Mvfr = 3,
    Vfr = 4
}

/// <summary>
/// FAA 14 CFR 91.155 — ceiling from lowest BKN/OVC layer (ft AGL) and
/// prevailing visibility in statute miles.
///   LIFR: ceiling &lt; 500 ft OR visibility &lt; 1 SM
///   IFR:  ceiling 500–999 ft OR visibility 1 to &lt; 3 SM
///   MVFR: ceiling 1000–3000 ft OR visibility 3 to 5 SM
///   VFR:  ceiling &gt; 3000 ft AND visibility &gt; 5 SM
/// Missing ceiling is treated as unlimited. Missing visibility is treated as unlimited.
/// </summary>
public static class FlightCategoryCalculator
{
    public static FlightCategory Compute(int? ceilingFt, double? visibilityStatuteMiles)
    {
        if (ceilingFt is null && visibilityStatuteMiles is null)
        {
            return FlightCategory.Unknown;
        }

        var ceiling = ceilingFt ?? int.MaxValue;
        var visibility = visibilityStatuteMiles ?? double.MaxValue;

        if (ceiling < 500 || visibility < 1d)
        {
            return FlightCategory.Lifr;
        }
        if (ceiling < 1000 || visibility < 3d)
        {
            return FlightCategory.Ifr;
        }
        if (ceiling <= 3000 || visibility <= 5d)
        {
            return FlightCategory.Mvfr;
        }
        return FlightCategory.Vfr;
    }

    public static string ToLabel(FlightCategory category) => category switch
    {
        FlightCategory.Vfr => "VFR",
        FlightCategory.Mvfr => "MVFR",
        FlightCategory.Ifr => "IFR",
        FlightCategory.Lifr => "LIFR",
        _ => "UNKN"
    };
}
