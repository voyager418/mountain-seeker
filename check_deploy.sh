#!/bin/bash

aws_host=http://ms-env-2.eba-vmhpnm8k.eu-west-1.elasticbeanstalk.com
stop_endpoint=$aws_host/stop

echo "Stopping all strategies..."
echo "Executing GET request to $stop_endpoint"
stop_result=$(curl -s -H "Accept: application/json" -H "Content-Type: application/json" $stop_endpoint)
echo "Response $stop_result"

running=$(echo "$stop_result" | grep -Po "\d+" | sed -n '2p')
if [ "$running" -ne "0" ]; then
    echo "Exiting as $running strategies are still running"
    exit 1
fi