<template>
  <v-container class="grey lighten-5">
      <b-tabs content-class="mt-3">
        <b-tab title="Cumulative % chart">
          <v-row>
            <canvas id="percent-line-chart"></canvas>
          </v-row>
        </b-tab>
        <b-tab title="Cumulative $ chart" active>
          <v-row>
            <canvas id="money-line-chart"></canvas>
          </v-row>
        </b-tab>
        <b-tab title="Monthly chart">
          <v-row>
            <canvas id="monthly-chart"></canvas>
          </v-row>
        </b-tab>
      </b-tabs>

    <v-row>
      <v-col>
        <v-text-field label="Email" v-model="email" @input="getTradingHistory"/>
        <v-text-field label="Start date" v-model="startDate" @input="getTradingHistory"/>
        <v-text-field label="End date" v-model="endDate" @input="getTradingHistory"/>
        <v-text-field label="Strategy" v-model="strategyName" @input="getTradingHistory"/>
        <v-text-field label="Take profit" v-model.number="takeProfit" @input="getTradingHistory"/>
        <v-text-field label="Max drawdown" v-model.number="maxDrawdown" disabled @input="getTradingHistory"/>
        <v-text-field label="Initial balance" v-model.number="initialBalance" v-if="this.email==='simulation'" @input="getTradingHistory"/>
        <v-text-field label="Default decrease percent" v-model.number="defaultDecreasePercent" v-if="this.email==='simulation'" @input="getTradingHistory"/>
        <v-checkbox
            v-model="findMaxProfit"
            label="find max profit "
            @change="getTradingHistory"
        ></v-checkbox>
      </v-col>

      <v-col>
        <label>Volume ratio {{ volumeRatio }}</label>
        <v-range-slider
            max="2000"
            min="0"
            ticks
            v-model="volumeRatio"
            @change="getTradingHistory"
        ></v-range-slider>
        <label>c1 variation {{ c1Variation }}</label>
        <v-range-slider
            max="100"
            min="1"
            step="0.5"
            ticks
            v-model="c1Variation"
            @change="getTradingHistory"
        ></v-range-slider>
        <label>c2 variation {{ c2Variation }}</label>
        <v-range-slider
            max="100"
            min="-10"
            step="0.5"
            ticks
            v-model="c2Variation"
            @change="getTradingHistory"
        ></v-range-slider>
      <label>chg 24h {{ chg24h }}</label>
        <v-range-slider
            max="600"
            min="-10"
            ticks
            v-model="chg24h"
            @change="getTradingHistory"
        ></v-range-slider>
      <label>Volume BUSD 5h {{ volumeBUSD5h }}</label>
        <v-range-slider
            max="100000000"
            min="40000"
            step="5000"
            v-model="volumeBUSD5h"
            @change="getTradingHistory"
        ></v-range-slider>
        <label>Edge variation {{ edgeVariation }}</label>
        <v-range-slider
            max="100"
            min="0"
            step="0.5"
            v-model="edgeVariation"
            @change="getTradingHistory"
        ></v-range-slider>
        <label>Max variation {{ maxVariation }}</label>
        <v-range-slider
            max="100"
            min="0"
            step="0.5"
            v-model="maxVariation"
            @change="getTradingHistory"
        ></v-range-slider>
        <label>c1 max var ratio {{ c1MaxVarRatio }}</label>
        <v-range-slider
            max="100"
            min="0"
            step="0.5"
            v-model="c1MaxVarRatio"
            @change="getTradingHistory"
        ></v-range-slider>
        <v-text-field label="Max dead times" v-model.number="maxDeadTimes" @input="getTradingHistory"/>
      </v-col>

    </v-row>
  </v-container>
</template>

<script>
import Chart from 'chart.js'
import { getPercentVariation, getTradingHistory, truncateNumber } from '@/services/DataService'

export default {
  name: 'MyChart',
  percentLineChart: undefined,
  moneyLineChart: undefined,
  monthlyChart: undefined,
  data() {
    return {
      email: "simulation",
      startDate: new Date("2022-06-01").toISOString(),
      endDate: new Date("2023-06-28").toISOString(),
      strategyName: "strat18-5-5",
      takeProfit: 11.19,
      maxDeadTimes: 1000,
      maxDrawdown: -4.8,
      initialBalance: 1000,
      volumeRatio: [14, 800],
      c1Variation: [10, 50],
      c2Variation: [-1.5, 7],
      chg24h: [0, 30],
      volumeBUSD5h: [80000, 100000000],
      edgeVariation: [2.5, 10],
      maxVariation: [4, 15],
      c1MaxVarRatio: [1, 3.5],
      findMaxProfit: false,
      defaultDecreasePercent: 0.5,
      chartOptions: {
        responsive: true,
        maintainAspectRatio: true,
        lineTension: 1,
        "legend": {
          "display": true,
          "labels": {
            "fontSize": 20,
          }
        },
        scales: {
          yAxes: [
            {
              ticks: {
                beginAtZero: true,
                padding: 25
              }
            }
          ]
        }
      }
    }
  },
  mounted() {
    this.percentLineChart = new Chart(document.getElementById('percent-line-chart'), {
      type: "line",
      data: { },
      options: this.chartOptions
    });
    this.moneyLineChart = new Chart(document.getElementById('money-line-chart'), {
      type: "line",
      data: { },
      options: this.chartOptions
    });
    this.monthlyChart = new Chart(document.getElementById('monthly-chart'), {
      type: "bar",
      data: { },
      options: this.chartOptions
    });
  },
  methods:{
    getTradingHistory() {
      getTradingHistory({
        email: this.email,
        startDate: this.startDate,
        endDate: this.endDate,
        strategyName: this.strategyName,
        takeProfit: this.takeProfit,
        maxDrawdown: this.maxDrawdown,
        initialBalance: this.initialBalance,
        volumeRatio: this.volumeRatio,
        c1Variation: this.c1Variation,
        c2Variation: this.c2Variation,
        chg24h: this.chg24h,
        volumeBUSD5h: this.volumeBUSD5h,
        edgeVariation: this.edgeVariation,
        maxVariation: this.maxVariation,
        c1MaxVarRatio: this.c1MaxVarRatio,
        findMaxProfit: this.findMaxProfit,
        defaultDecreasePercent: this.defaultDecreasePercent,
        maxDeadTimes: this.maxDeadTimes
      }).then(response => {
        this.updatePercentLineChart(response);
        this.updateMoneyLineChart(response);
        this.updateMonthlyChart(response);
      }).catch(e => console.log(e))
    },
    updatePercentLineChart(response) {
      const xValues = response.statesInfo.map(x => x.state.endDate);
      const yValues = response.statesInfo.map(x => x.simulationInfo.cumulativeProfitPercent);
      this.percentLineChart.data.labels = xValues;
      this.percentLineChart.data.datasets = [{
        label: `profit % = ${response.globalInfo.totalProfit} | profitable = ${response.globalInfo.profitable} | take profit = ${response.globalInfo.takeProfit} | trades = ${response.globalInfo.totalTrades}`,
        data: yValues,
        backgroundColor: "rgba(71, 183,132,.5)",
        borderColor: "#47b784",
        borderWidth: 3
      }];
      this.updateLineLabels(response, this.percentLineChart, false);
      this.percentLineChart.update();
    },
    updateMoneyLineChart(response) {
      const xValues = response.statesInfo.map(x => x.state.endDate);
      const yValues = response.statesInfo.map(x => x.simulationInfo.cumulativeProfitMoney);
      this.moneyLineChart.data.labels = xValues;
      this.moneyLineChart.data.datasets = [{
        label: `profit = ${this.email === "simulation" ? yValues[yValues.length - 1] : response.statesInfo[response.statesInfo.length - 1].state.retrievedAmountOfBusd}$
/ ${this.email === "simulation" ? response.globalInfo.simulationMoneyProfitPercent : 0}%
| profitable = ${response.globalInfo.profitable}% | take profit = ${response.globalInfo.takeProfit}% | trades = ${response.globalInfo.totalTrades}`,
        data: yValues,
        backgroundColor: "rgba(71, 183,132,.5)",
        borderColor: "#47b784",
        borderWidth: 3
      }];
      this.updateLineLabels(response, this.moneyLineChart, true);
      this.moneyLineChart.update();
    },
    updateMonthlyChart(response) {
      let months = response.statesInfo.map(x => x.state.endDate.substring(0, 7));
      months = [...new Set(months)];
      this.monthlyChart.data.labels = months;
      let tradesPerMonth = [];
      let currentMonth = 0;
      let currentTradesPerMonth = 0;
      for (const elem of response.statesInfo) {
        if (elem.state.endDate.startsWith(months[currentMonth])) {
          currentTradesPerMonth++;
        } else {
          currentMonth++;
          tradesPerMonth.push(currentTradesPerMonth);
          currentTradesPerMonth = 1;
        }
      }
      tradesPerMonth.push(currentTradesPerMonth);
      let profitPercentPerMonth = [];
      if (this.email === "simulation") {
        for (let i = 0; i < tradesPerMonth.length; i++) {
            const tradesForThisMonth = tradesPerMonth.slice(0, i+1).reduce((a, b) => a + b, 0);
            const tradesBeforeThisMonth = tradesPerMonth.slice(0, i).reduce((a, b) => a + b, 0);
            let startAmount;
            if (i === 0) {
              startAmount = this.initialBalance;
            } else {
              startAmount = response.statesInfo[tradesBeforeThisMonth-1].simulationInfo.cumulativeProfitMoney;
            }
            profitPercentPerMonth.push(getPercentVariation(startAmount, response.statesInfo[tradesForThisMonth-1].simulationInfo.cumulativeProfitMoney));
        }
      } else {
        // TODO
      }

      this.monthlyChart.data.datasets = [{
        label: `average profit = ${truncateNumber(profitPercentPerMonth.reduce((a, b) => a + b, 0) / profitPercentPerMonth.length, 2)}%
| average trades = ${truncateNumber(tradesPerMonth.reduce((a, b) => a + b, 0) / tradesPerMonth.length, 1)}`,
        data: profitPercentPerMonth,
        backgroundColor: "rgba(71, 183,132,.5)",
        borderColor: "#47b784",
        borderWidth: 3
      }];
      this.updateMonthlyChartLabels(response, this.monthlyChart, tradesPerMonth, profitPercentPerMonth);
      this.monthlyChart.update();
    },
    updateLineLabels(response, chart, moneyLine) {
      chart.options.tooltips =
          {
            // Disable the on-canvas tooltip
            enabled: false,

            custom: function (tooltipModel) {
              // Tooltip Element
              var tooltipEl = document.getElementById('chartjs-tooltip');

              // Create element on first render
              if (!tooltipEl) {
                tooltipEl = document.createElement('div');
                tooltipEl.id = 'chartjs-tooltip';
                tooltipEl.innerHTML = '<table></table>';
                document.body.appendChild(tooltipEl);
              }

              // Hide if no tooltip
              if (tooltipModel.opacity === 0) {
                tooltipEl.style.opacity = 0;
                return;
              }

              // Set caret Position
              tooltipEl.classList.remove('above', 'below', 'no-transform');
              if (tooltipModel.yAlign) {
                tooltipEl.classList.add(tooltipModel.yAlign);
              } else {
                tooltipEl.classList.add('no-transform');
              }

              function getBody(bodyItem) {
                return bodyItem.lines;
              }

              // Set Text
              if (tooltipModel.body) {
                var bodyLines = tooltipModel.body.map(getBody, this.email);
                var innerHtml = '<div style="background-color: #ffffff; font-size: 20px; position: static;>';

                bodyLines.forEach(function (body, email) {
                  // var colors = tooltipModel.labelColors[i];
                  var style = 'background:' + "red";
                  // style += '; border-color:' + colors.borderColor;
                  // style += '; border-width: 1px';
                  var span = '<span style="' + style + '"></span>';
                  const cumulProfit = body[0].substring(body[0].lastIndexOf(": ")+2);
                  let hoveredState;
                  console.log(email);
                  if (!moneyLine) {
                    hoveredState = response.statesInfo.filter(s => s.simulationInfo.cumulativeProfitPercent == cumulProfit)[0];
                  } else {
                    hoveredState = response.statesInfo.filter(s => s.simulationInfo.cumulativeProfitMoney == cumulProfit)[0];
                  }
                  console.log(hoveredState); // TODO remove later
                  hoveredState = {
                    y: !moneyLine ? hoveredState.simulationInfo.cumulativeProfitPercent : hoveredState.simulationInfo.cumulativeProfitMoney,
                    profitPercent: hoveredState.state.profitPercent,
                    profitMoney: hoveredState.state.profitMoney,
                    market: hoveredState.state.marketSymbol,
                    metadata: hoveredState.state.strategyDetails.metadata,
                    last5CandleSticksPercentageVariations: hoveredState.state.last5CandleSticksPercentageVariations,
                    chg24h: hoveredState.state.marketPercentChangeLast24h,
                    drawDown: hoveredState.state.drawDown,
                    runUp: hoveredState.state.runUp
                  };
                  innerHtml += span + JSON.stringify(hoveredState, null, " ") ;
                });
                innerHtml += '</div>';

                var tableRoot = tooltipEl.querySelector('table');
                tableRoot.innerHTML = innerHtml;
              }

              // `this` will be the overall tooltip
              var position = this._chart.canvas.getBoundingClientRect();

              // Display, position, and set styles for font
              tooltipEl.style.opacity = 1;
              tooltipEl.style.position = 'absolute';
              tooltipEl.style.left = position.left + window.pageXOffset + tooltipModel.caretX/2 + 'px';
              tooltipEl.style.top = position.top + window.pageYOffset + tooltipModel.caretY + 'px';
              tooltipEl.style.fontFamily = tooltipModel._bodyFontFamily;
              tooltipEl.style.fontSize = tooltipModel.bodyFontSize + 'px';
              tooltipEl.style.fontStyle = tooltipModel._bodyFontStyle;
              tooltipEl.style.padding = tooltipModel.yPadding + 'px ' + tooltipModel.xPadding + 'px';
              tooltipEl.style.pointerEvents = 'none';
            }
          }
    },
    updateMonthlyChartLabels(response, chart, tradesPerMonth, profitPercentPerMonth) {
      chart.options.tooltips =
          {
            // Disable the on-canvas tooltip
            enabled: false,

            custom: function (tooltipModel) {
              // Tooltip Element
              var tooltipEl = document.getElementById('chartjs-tooltip');

              // Create element on first render
              if (!tooltipEl) {
                tooltipEl = document.createElement('div');
                tooltipEl.id = 'chartjs-tooltip';
                tooltipEl.innerHTML = '<table></table>';
                document.body.appendChild(tooltipEl);
              }

              // Hide if no tooltip
              if (tooltipModel.opacity === 0) {
                tooltipEl.style.opacity = 0;
                return;
              }

              // Set caret Position
              tooltipEl.classList.remove('above', 'below', 'no-transform');
              if (tooltipModel.yAlign) {
                tooltipEl.classList.add(tooltipModel.yAlign);
              } else {
                tooltipEl.classList.add('no-transform');
              }

              function getBody(bodyItem) {
                return bodyItem.lines;
              }

              // Set Text
              if (tooltipModel.body) {
                var bodyLines = tooltipModel.body.map(getBody);
                var innerHtml = '<div style="background-color: #ffffff; font-size: 20px; position: static;>';
                bodyLines.forEach(function (body) {
                  var style = 'background:' + "red";
                  var span = '<span style="' + style + '"></span>';
                  const profitPercent = parseFloat(body[0].substring(body[0].lastIndexOf(": ")+2));
                  const i = profitPercentPerMonth.indexOf(profitPercent);
                  const hoveredBox = {
                    profitPercent: profitPercent,
                    totalTrades: tradesPerMonth[i]
                  }
                  innerHtml += span + JSON.stringify(hoveredBox, null, " ") ;
                });
                innerHtml += '</div>';

                var tableRoot = tooltipEl.querySelector('table');
                tableRoot.innerHTML = innerHtml;
              }

              // `this` will be the overall tooltip
              var position = this._chart.canvas.getBoundingClientRect();

              // Display, position, and set styles for font
              tooltipEl.style.opacity = 1;
              tooltipEl.style.position = 'absolute';
              tooltipEl.style.left = position.left + window.pageXOffset + tooltipModel.caretX/2 + 'px';
              tooltipEl.style.top = position.top + window.pageYOffset + tooltipModel.caretY + 'px';
              tooltipEl.style.fontFamily = tooltipModel._bodyFontFamily;
              tooltipEl.style.fontSize = tooltipModel.bodyFontSize + 'px';
              tooltipEl.style.fontStyle = tooltipModel._bodyFontStyle;
              tooltipEl.style.padding = tooltipModel.yPadding + 'px ' + tooltipModel.xPadding + 'px';
              tooltipEl.style.pointerEvents = 'none';
            }
          }
    }
  }
}
</script>