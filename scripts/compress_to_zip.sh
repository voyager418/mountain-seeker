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

cd tempFolder/dist && mkdir ui && cd ../..
cp -a ui/dist tempFolder/dist/ui

cd tempFolder && zip -r ../"$fileName" ./* && cd ..

rm -rf tempFolder

printf "Created %s of size " "$fileName" && du -h "$fileName" | awk '{print $1}'