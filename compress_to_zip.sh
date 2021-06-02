#!/bin/bash

fileName=$1

rm -rf tempFolder "$fileName"

mkdir tempFolder

cp -a .ebextensions \
		.eslintignore \
		.eslintrc \
		config \
		node_modules \
		package.json \
		src \
		tsconfig.json \
		tempFolder

ditto -c -k --sequesterRsrc tempFolder "$fileName"

rm -rf tempFolder

echo "Created $fileName"