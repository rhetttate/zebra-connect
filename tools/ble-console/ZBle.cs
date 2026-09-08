using System; using System.Text; using System.Threading; using System.Runtime.InteropServices.WindowsRuntime;
using Windows.Devices.Bluetooth; using Windows.Devices.Bluetooth.GenericAttributeProfile; using Windows.Storage.Streams;
public class ZBle {
  BluetoothLEDevice dev; GattCharacteristic wr, rd; StringBuilder rx = new StringBuilder(); object l = new object();
  public string Connect(ulong addr) {
    dev = BluetoothLEDevice.FromBluetoothAddressAsync(addr).AsTask().Result; if (dev == null) return "device not found";
    var s = dev.GetGattServicesForUuidAsync(new Guid("38eb4a80-c570-11e3-9507-0002a5d5c51b"), BluetoothCacheMode.Uncached).AsTask().Result; if (s.Services.Count == 0) return "no zebra service: " + s.Status;
    var c = s.Services[0].GetCharacteristicsAsync(BluetoothCacheMode.Uncached).AsTask().Result;
    foreach (var ch in c.Characteristics) { if (ch.Uuid == new Guid("38eb4a82-c570-11e3-9507-0002a5d5c51b")) wr = ch; if (ch.Uuid == new Guid("38eb4a81-c570-11e3-9507-0002a5d5c51b")) rd = ch; }
    if (wr == null || rd == null) return "chars missing";
    rd.ValueChanged += (o, e) => { var b = e.CharacteristicValue.ToArray(); lock (l) rx.Append(Encoding.ASCII.GetString(b)); };
    var st = rd.WriteClientCharacteristicConfigurationDescriptorAsync(GattClientCharacteristicConfigurationDescriptorValue.Indicate).AsTask().Result;
    return "connected name=" + dev.Name + " indicate=" + st;
  }
  public string Send(string cmd, int waitMs) {
    lock (l) rx.Clear();
    var bytes = Encoding.ASCII.GetBytes(cmd);
    for (int i = 0; i < bytes.Length; i += 240) { int n = Math.Min(240, bytes.Length - i); var chunk = new byte[n]; Array.Copy(bytes, i, chunk, 0, n); var st = wr.WriteValueAsync(chunk.AsBuffer(), GattWriteOption.WriteWithResponse).AsTask().Result; if (st != GattCommunicationStatus.Success) return "WRITE FAILED: " + st; }
    var end = DateTime.Now.AddMilliseconds(waitMs); int last = 0; DateTime lastChange = DateTime.Now;
    while (DateTime.Now < end) {
      Thread.Sleep(100); int len; lock (l) len = rx.Length;
      if (len != last) { last = len; lastChange = DateTime.Now; }
      else if (len > 0 && (DateTime.Now - lastChange).TotalMilliseconds > 1200) break;
    }
    lock (l) return rx.ToString();
  }
  public string Drain(int waitMs) {
    // Collect anything that arrives without sending (handles late replies).
    var end = DateTime.Now.AddMilliseconds(waitMs); int last; lock (l) last = rx.Length; DateTime lastChange = DateTime.Now;
    while (DateTime.Now < end) { Thread.Sleep(100); int len; lock (l) len = rx.Length; if (len != last) { last = len; lastChange = DateTime.Now; } else if ((DateTime.Now - lastChange).TotalMilliseconds > 1200) break; }
    lock (l) return rx.ToString();
  }
  public string Status() { return dev == null ? "none" : dev.ConnectionStatus.ToString(); }
  public void Close() { if (dev != null) dev.Dispose(); }
}
