## Trading bot

An automatic trading bot written in TypeScript.

### Requirements

- Node.js v14.16.0
- npm v6.14.11

run dynamodb docker image : docker-compose up

list dynamo db tables :  aws dynamodb list-tables --endpoint-url http://localhost:8000

dynamo db shell : http://localhost:8000/shell/

### Some useful commands for development

- `npm run dev` : starts the server
- `npm run hot-reload` : starts the server and automatically restarts it on detected code changes
- `npm run test` : runs tests
- `docker-compose up` : run dynamo DB docker image
- `aws dynamodb list-tables --endpoint-url http://localhost:8000`: list dynamo DB tables

### Some useful URLs
- dynamo DB shell : http://localhost:8000/shell/
