const axios = require('axios');

export async function getTradingHistory(body) {
    const response = await axios.post('/api/tradingstates/get', body);
    return response.data;
}