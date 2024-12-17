#!/bin/bash
set -e

#IMAGE=500518139216.dkr.ecr.us-east-1.amazonaws.com/raftainer-core
IMAGE=192.168.6.10:5001/raftainer-core
TAG=`node -e "console.log(require('./package.json').version);"`

docker build -t $IMAGE:$TAG .
docker push $IMAGE:$TAG
docker tag $IMAGE:$TAG $IMAGE:latest
docker push $IMAGE:latest
