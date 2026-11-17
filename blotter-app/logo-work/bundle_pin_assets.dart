// ignore_for_file: avoid_print
import 'dart:io';
import 'package:image/image.dart' as img;

void main() {
  final bg = img.decodeImage(File('bluewrite/src/assets/police_station_sidebar_background.png').readAsBytesSync())!;
  final bgSmall = img.copyResize(bg, width: 1080);
  File('blotter-app/assets/pin-station.jpg').writeAsBytesSync(img.encodeJpg(bgSmall, quality: 72));
  print('pin-station.jpg ${bgSmall.width}x${bgSmall.height}');
  for (final job in [
    ['bluewrite/src/assets/pnp-logo.png', 'blotter-app/assets/pin-pnp.png', 480],
    ['bluewrite/src/assets/city-of-naga-seal.png', 'blotter-app/assets/pin-seal.png', 480],
  ]) {
    final src = img.decodeImage(File(job[0] as String).readAsBytesSync())!;
    final w = job[2] as int;
    final h = (src.height * w / src.width).round();
    File(job[1] as String).writeAsBytesSync(img.encodePng(img.copyResize(src, width: w, height: h)));
    print('${job[1]} ${w}x$h');
  }
}
