#!/bin/bash

aws_host=http://ms-env.eba-vmhpnm8k.eu-west-1.elasticbeanstalk.com
stop_endpoint=$aws_host/api/stop/all

echo "Stopping all strategies..."
echo "Executing GET request to $stop_endpoint"
stop_result=$(curl -s -H "Accept: application/json" -H "Content-Type: application/json" $stop_endpoint)
echo "<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<"
echo "Response $stop_result"
echo "<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<"

if [[ ! $stop_result =~ "removed" ]]; then
  echo "Something went wrong"
  exit 1
fi

# grep -o -E "\d+" matches all the numbers
# so if input is {"running":0,"total":5} it will print 2 lines : 0 and 5
# on Mac grep -Po doesn't work, need to use -o -E
running=$(echo "$stop_result" | grep -Po "\d+" | sed -n '2p')
if [ "$running" -ne "0" ]; then
    echo "Exiting as $running strategies are still running"
    exit 1
fi