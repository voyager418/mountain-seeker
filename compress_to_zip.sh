#!/bin/bash

fileName=$1

echo "Compressing to $fileName"

rm -rf tempFolder "$fileName"

mkdir tempFolder

cp -a .ebextensions \
		.eslintignore \
		.eslintrc \
		config \
		node_modules \
		dist \
		package.json \
		src \
		tsconfig.json \
		tempFolder

ditto -c -k --sequesterRsrc tempFolder "$fileName"

rm -rf tempFolder

printf "Created %s of size " "$fileName" && du -h "$fileName" | awk '{print $1}'