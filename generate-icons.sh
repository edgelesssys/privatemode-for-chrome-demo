#!/bin/bash

# Script to generate downsized icons from icon.png using ImageMagick

set -e

if command -v magick &> /dev/null; then
    CONVERT_CMD="magick"
elif command -v convert &> /dev/null; then
    CONVERT_CMD="convert"
else
    echo "ImageMagick is not installed. Please install it first."
    exit 1
fi

cd images

echo "Generating icon16.png..."
$CONVERT_CMD icon.png -resize 16x16 icon16.png

echo "Generating icon32.png..."
$CONVERT_CMD icon.png -resize 32x32 icon32.png

echo "Generating icon48.png..."
$CONVERT_CMD icon.png -resize 48x48 icon48.png

echo "Generating icon128.png..."
$CONVERT_CMD icon.png -resize 128x128 icon128.png

echo "Icon generation complete."
