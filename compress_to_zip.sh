#!/bin/bash

rm -rf tempFolder MS.zip

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

ditto -c -k --sequesterRsrc tempFolder MS.zip

rm -rf tempFolder

echo "Created MS.zip"