<template>
  <v-container class="grey lighten-5">
    <v-row>
      <canvas id="my-chart"></canvas>
    </v-row>

    <v-row>
      <v-col>
        <v-text-field label="Email" v-model="email" @input="getTradingHistory"/>
        <v-text-field label="Start date" v-model="startDate" @input="getTradingHistory"/>
        <v-text-field label="End date" v-model="endDate" @input="getTradingHistory"/>
        <v-text-field label="Strategy" v-model="strategyName" @input="getTradingHistory"/>
        <v-text-field label="Take profit" v-model.number="takeProfit" @input="getTradingHistory"/>
        <v-text-field label="Max drawdown" v-model.number="maxDrawdown" @input="getTradingHistory"/>
        <v-checkbox
            v-model="findMaxProfit"
            label="find max profit "
            @change="getTradingHistory"
        ></v-checkbox>

      </v-col>

      <v-col>
        <label>Volume ratio {{ volumeRatio }}</label>
        <v-range-slider
            max="500"
            min="0"
            ticks
            v-model="volumeRatio"
            @change="getTradingHistory"
        ></v-range-slider>
        <label>c1 variation {{ c1Variation }}</label>
        <v-range-slider
            max="100"
            min="5"
            ticks
            v-model="c1Variation"
            @change="getTradingHistory"
        ></v-range-slider>
        <label>c2 variation {{ c2Variation }}</label>
        <v-range-slider
            max="100"
            min="-10"
            ticks
            v-model="c2Variation"
            @change="getTradingHistory"
        ></v-range-slider>
      <label>chg 24h {{ chg24h }}</label>
        <v-range-slider
            max="100"
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
      </v-col>

    </v-row>
  </v-container>
</template>

<script>
import Chart from 'chart.js'
import { getTradingHistory } from '@/services/DataService'

export default {
  name: 'MyChart',
  chart: undefined,
  data() {
    return {
      email: "simulation",
      startDate: new Date("2022-06-01").toISOString(),
      endDate: new Date("2023-06-28").toISOString(),
      strategyName: "strat18-5-5",
      takeProfit: undefined,
      maxDrawdown: -4.8,
      volumeRatio: [17, 85],
      c1Variation: [8, 50],
      c2Variation: [-0.9, 7],
      chg24h: [-10, 30],
      volumeBUSD5h: [60000, 100000000],
      edgeVariation: [1, 10],
      maxVariation: [0, 100],
      c1MaxVarRatio: [0, 5],
      findMaxProfit: false,
      xValues: [],
      yValues: [],
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
    const ctx = document.getElementById('my-chart');
    this.chart = new Chart(ctx, {
      type: "line",
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
        volumeRatio: this.volumeRatio,
        c1Variation: this.c1Variation,
        c2Variation: this.c2Variation,
        chg24h: this.chg24h,
        volumeBUSD5h: this.volumeBUSD5h,
        edgeVariation: this.edgeVariation,
        maxVariation: this.maxVariation,
        c1MaxVarRatio: this.c1MaxVarRatio,
        findMaxProfit: this.findMaxProfit
      }).then(response => {
        console.log(response);
        this.xValues = response.statesInfo.map(x => x.state.endDate);
        this.yValues = response.statesInfo.map(x => x.simulationInfo.cumulativeProfitPercent);
        this.chart.data.labels = this.xValues;
        this.chart.data.datasets = [{
          label: `total profit = ${response.globalInfo.totalProfit} | profitable = ${response.globalInfo.profitable} | takeProfit = ${response.globalInfo.takeProfit} | trades = ${response.globalInfo.totalTrades}`,
          data: this.yValues,
          backgroundColor: "rgba(71, 183,132,.5)",
          borderColor: "#47b784",
          borderWidth: 3
        }];
        this.updateChartLabels(response);
        this.chart.update();
      }).catch(e => console.log(e))
    },
    updateChartLabels(response) {
      this.chart.options.tooltips =
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
                // var titleLines = tooltipModel.title || [];
                var bodyLines = tooltipModel.body.map(getBody);

                var innerHtml = '<div style="background-color: #ffffff; font-size: 20px; position: static;>';

                // titleLines.forEach(function(title) {
                //   innerHtml += '<tr><th>' + title + '</th></tr>';
                // });
                // innerHtml += '</thead><tbody>';

                bodyLines.forEach(function (body) {
                  // var colors = tooltipModel.labelColors[i];
                  var style = 'background:' + "red";
                  // style += '; border-color:' + colors.borderColor;
                  // style += '; border-width: 1px';
                  var span = '<span style="' + style + '"></span>';
                  const cumulProfit = body[0].substring(body[0].lastIndexOf(": ")+2);
                  let hoveredState = response.statesInfo.filter(s => s.simulationInfo.cumulativeProfitPercent == cumulProfit)[0];
                  console.log(hoveredState)
                  hoveredState = {
                    y: hoveredState.simulationInfo.cumulativeProfitPercent,
                    profit: response.globalInfo.takeProfit && response.globalInfo.takeProfit <= hoveredState.state.runUp ? response.globalInfo.takeProfit : hoveredState.state.profitPercent,
                    metadata: hoveredState.state.strategyDetails.metadata,
                    last5CandleSticksPercentageVariations: hoveredState.state.last5CandleSticksPercentageVariations,
                    chg24h: hoveredState.state.marketPercentChangeLast24h,
                    drawDown: hoveredState.state.drawDown,
                    runUp: hoveredState.state.runUp
                  };
                  // innerHtml += '<tr><th>' + span + JSON.stringify(hoveredState.state.strategyDetails.metadata, null, " ") + '</th></tr>';
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
    }
  }
}
</script>