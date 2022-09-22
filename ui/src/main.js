import App from './App.vue'
import Vue from 'vue'
import Vuetify from "vuetify";
import 'vuetify/dist/vuetify.min.css'
import BootstrapVue from "bootstrap-vue";
import "bootstrap/dist/css/bootstrap.css";
import "bootstrap-vue/dist/bootstrap-vue.css";

Vue.use(Vuetify);
Vue.use(BootstrapVue);

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