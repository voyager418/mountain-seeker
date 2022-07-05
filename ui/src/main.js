import App from './App.vue'
import Vue from 'vue'
import Vuetify from "vuetify";
import 'vuetify/dist/vuetify.min.css'

Vue.use(Vuetify);

new Vue({
    vuetify: new Vuetify({
        icons: {
            iconfont: 'mdiSvg',
        },
    }),
    el: "#app",
    components: { App },
    template: "<App/>"
});