const axios = require('axios');

export async function getTradingHistory(body) {
    const response = await axios.post('/api/tradingstates/get', body);
    return response.data;
}

export function getPercentVariation(start, end) {
    if (start === 0) {
        start = 0.00000001;
    }
    if (start <= end) {
        return truncateNumber(Math.abs(((end - start) / start) * 100), 2);
    } else {
        return truncateNumber(-((start - end) / start) * 100, 2);
    }
}

function truncateNumber(number, digitsAfterDot) {
    if (number.toString().split(".")[1]?.length > digitsAfterDot) {
        return Math.trunc(number * Math.pow(10, digitsAfterDot)) / Math.pow(10, digitsAfterDot);
    }
    return number;
}