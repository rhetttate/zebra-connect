using System; using System.Collections.Generic; using System.Text; using System.Threading;
using Windows.Devices.Bluetooth.Advertisement;
// Passive BLE advertisement scan: reports what a given address broadcasts (name, service UUIDs, flags).
public class ZBleScan {
  public static string Scan(ulong addr, int ms) {
    var sb = new StringBuilder(); var seen = new HashSet<string>(); int count = 0;
    var w = new BluetoothLEAdvertisementWatcher(); w.ScanningMode = BluetoothLEScanningMode.Active;
    w.Received += (s, e) => {
      if (e.BluetoothAddress != addr) return; count++;
      var a = e.Advertisement; var uuids = new List<string>(); foreach (var u in a.ServiceUuids) uuids.Add(u.ToString());
      var line = "type=" + e.AdvertisementType + " rssi=" + e.RawSignalStrengthInDBm + " name=[" + a.LocalName + "] flags=" + (a.Flags.HasValue ? a.Flags.Value.ToString() : "-") + " serviceUuids=[" + string.Join(",", uuids) + "] sections=" + a.DataSections.Count;
      lock (seen) { if (seen.Add(line)) sb.AppendLine(line); }
    };
    w.Start(); Thread.Sleep(ms); w.Stop();
    sb.AppendLine("advertisements from target: " + count);
    return sb.ToString();
  }
}
