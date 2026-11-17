// ignore_for_file: avoid_print
import 'dart:io';
import 'package:image/image.dart' as img;

// Run from the repo root:
//   dart --packages=blotter-app/.dart_tool/package_config.json blotter-app/logo-work/make-assets.dart
void main(List<String> args) {
  final from = args.isNotEmpty ? args.first : 'blotter-app/logo-work/draft-v3.png';
  final src = img.decodeImage(File(from).readAsBytesSync());
  if (src == null) throw StateError('could not decode render');
  print('render: ${src.width}x${src.height}');
  // Center-crop to a square, then export.
  final side = src.width < src.height ? src.width : src.height;
  final sq = img.copyCrop(src,
      x: (src.width - side) ~/ 2, y: (src.height - side) ~/ 2,
      width: side, height: side);
  File('blotter-app/assets/bluewrite-mark.png')
      .writeAsBytesSync(img.encodePng(img.copyResize(sq, width: 512, height: 512)));
  print('assets/bluewrite-mark.png -> 512px ok');
  const sizes = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
  };
  sizes.forEach((dir, px) {
    File('blotter-app/android/app/src/main/res/$dir/ic_launcher.png')
        .writeAsBytesSync(img.encodePng(
            img.copyResize(sq, width: px, height: px,
                interpolation: img.Interpolation.cubic)));
    print('$dir -> ${px}px ok');
  });
}
