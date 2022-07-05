<template>
  <div id="app">
    <v-app>
      <MyChart/>
    </v-app>
  </div>
</template>

<script>
import MyChart from './components/MyChart.vue'

export default {
  name: 'App',
  components: { MyChart }
}
</script>
