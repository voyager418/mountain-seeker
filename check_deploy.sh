#!/bin/bash

aws_host=http://ms-env-2.eba-vmhpnm8k.eu-west-1.elasticbeanstalk.com
status_endpoint=$aws_host/status
stop_endpoint=$aws_host/stop

echo "Executing GET request to $status_endpoint"
status_result=$(curl -s -H "Accept: application/json" -H "Content-Type: application/json" $status_endpoint)
echo "Response $status_result"

# grep -o -E "\d+" matches all the numbers
# so if input is {"running":0,"total":5} it will print 2 lines : 0 and 5
# on Mac grep -Po doesn't work, need to use -o -E
running=$(echo "$status_result" | grep -Po "\d+" | sed -n '2p') # 2p prints second line
echo "Running strategies: $running"

if (( running != 0 )); then
    echo "Exiting as there are $running running strategies"
    exit 1
fi

echo "Stopping all strategies..."
echo "Executing GET request to $stop_endpoint"
stop_result=$(curl -s -H "Accept: application/json" -H "Content-Type: application/json" $stop_endpoint)
echo "Response $stop_result"

running=$(echo "$stop_result" | grep -Po "\d+" | sed -n '2p')
if (( running != 0 )); then
    echo "Exiting as there are $running running strategies (after stopping)"
    exit 1
fi