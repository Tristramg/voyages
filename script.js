// Computes the distance
function haversine(leg){
    let R = 6371; // kilometres
    let φ1 = parseFloat(leg.departure.latitude) * Math.PI / 180;
    let φ2 = parseFloat(leg.arrival.latitude) * Math.PI / 180;
    let Δφ = φ2-φ1;
    let Δλ = (parseFloat(leg.arrival.longitude) - parseFloat(leg.departure.longitude)) * Math.PI / 180;


    let a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ/2) * Math.sin(Δλ/2);
    let c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
}

// Some pnrs are round trips. It can be confusing to have a summed distance
function distance(legs) {
    return _(legs).map(haversine).sum();
}

// If a leg is a round-trip, it considers as twice half the distance
function distance_round_trip(legs) {
    let dist = distance(legs);
    if(is_round_trip(legs)) {
        return [dist/2, dist/2];
    } else {
        return [dist];
    }
}

function duration(leg) {
    return moment(leg.arrival_date) - moment(leg.departure_date);
}

function total_duration(legs, divide_if_roundtrip) {
    let d = _(legs).map(duration).sum();
    if (divide_if_roundtrip) {
        return d / 2;
    } else {
        return d;
    }
}

// If a station is both destination and arrival, we suppose it’s a round-trip
function is_round_trip(legs) {
    return !_(legs).map('departure.public_id')
                   .intersection(_.map(legs, 'arrival.public_id'))
                   .isEmpty();
}

function histogram(data, el){
    let svg    = d3.select(el),
        margin = {top: 10, right: 30, bottom: 30, left: 30},
        width  = +svg.attr("width") - margin.left - margin.right,
        height = +svg.attr("height") - margin.top - margin.bottom,
        g      = svg.append("g").attr("transform", "translate(" + margin.left + "," + margin.top + ")");

    let x = d3.scaleLinear()
              .domain([0, _.max(data)])
              .rangeRound([0, width]);
    let bins = d3.histogram()
                 .domain(x.domain())
                 .thresholds(10)
                 (data);
    let y = d3.scaleLinear()
              .domain([0, d3.max(bins, d => d.length)])
              .range([height, 0]);
    let bar = g.selectAll(".bar")
               .data(bins)
               .enter().append("g")
               .attr("class", "bar")
               .attr("transform", d =>  `translate(${x(d.x0)}, ${y(d.length)})`);

    bar.append("rect")
       .attr("x", 1)
       .attr("width", x(bins[0].x1) - x(bins[0].x0) - 1)
       .attr("height", d => height - y(d.length));

    bar.append("rect")
       .attr("x", 1)
       .attr("width", x(bins[0].x1) - x(bins[0].x0) - 1)
       .attr("height", d => height - y(d.length) );

    bar.append("text")
       .attr("dy", ".75em")
       .attr("y", 6)
       .attr("x", (x(bins[0].x1) - x(bins[0].x0)) / 2)
       .attr("text-anchor", "middle")
       .text(d => d.length);

    g.append("g")
     .attr("class", "axis axis--x")
     .attr("transform", "translate(0," + height + ")")
     .call(d3.axisBottom(x));
}

function pie(data, el){
    var svg    = d3.select(el),
        margin = {top: 10, right: 30, bottom: 30, left: 30},
        width  = +svg.attr("width") - margin.left - margin.right,
        height = +svg.attr("height") - margin.top - margin.bottom,
        r      = Math.min(width, height) / 2;
        color  = d3.scaleOrdinal(d3.schemeCategory10),
        pie    = d3.pie().value(d => d[1]),
        arc    = d3.arc().outerRadius(r).innerRadius(r/2),
        arcs   = svg.selectAll("g.slice")
                    .data(pie(data)).enter()
                    .append("svg:g")
                    .attr("class", "slice")
                    .attr("transform", `translate(${width/2}, ${height/2})`),

        arcs.append("svg:path")
            .attr("fill", (d, i) => color(i))
            .attr("d", arc);
        arcs.append("svg:text")
            .attr("transform", d => `translate(${arc.centroid(d)})`)
            .attr("text-anchor", "middle")
            .text((d, i) => d.data[0]);
}

function map(legs) {
  var map = L.Mapzen.map('map');
  map.setView([46.905, 2.395], 5);
  legs.forEach(leg => L.polyline([[parseFloat(leg.departure.latitude), parseFloat(leg.departure.longitude)],
                                  [parseFloat(leg.arrival.latitude), parseFloat(leg.arrival.longitude)]],
                                  {opacity: 0.5}
                                ).addTo(map));
}

function display(json) {
    moment.locale('fr');
    let subscription = moment(json.account.signed_up_at);
    let actual_pnrs = _(json.pnrs).filter(p => p.emitted_at && p.travelers.length > 0);
    let travelers = _(actual_pnrs).flatMap('travelers')
                                  .countBy(t => `${t.first_name} ${t.last_name[0]}.`);
    let is_self = traveler => (traveler.first_name == json.account.first_name && traveler.last_name == json.account.last_name);
    let my_pnrs = actual_pnrs.filter(pnr => _.some(pnr.travelers, is_self));
    let payments = _(json.payments).filter(p => p.state == 'Success');
    let by_card = payments.filter(p => p.payment_mean && p.payment_mean.type == 'payment_card')
                          .groupBy('payment_mean.last_digits')
                          .mapValues(p => _.sumBy(p, 'amount.cents')/100);
    let legs = my_pnrs.map('legs').flatten();
    let total_time = legs.map(duration).sum();

    var app = new Vue({
        el: '#app',
        data: {
            subscription: subscription.format('LLL'),
            since: subscription.fromNow(),
            first_name: json.account.first_name,
            last_name: json.account.last_name,
            count: travelers.size(),
            passengers: travelers.toPairs().sortBy(t => t[1]).reverse().value(),
            count_alone: actual_pnrs.map('travelers').filter(t => _.every(t, is_self)).size(),
            count_mixed: actual_pnrs.map('travelers').filter(t => _.some(t, is_self) && t.length >= 2).size(),
            count_other: actual_pnrs.map('travelers').reject(t => _.some(t, is_self)).size(),
            count_four: actual_pnrs.map('travelers').filter(t => t.length >= 4).size(),
            sum: payments.sumBy('amount.cents') / 100,
            quick: payments.filter('quick_payment').sumBy('amount.cents') / 100,
            by_card: by_card.value(),
            by_coupon: payments.filter(p => p.payment_mean && p.payment_mean.type == 'coupon').sumBy('amount.cents') / 100,
            total_time: moment.duration(total_time).humanize(),
        }
    });

    let distances = actual_pnrs.flatMap(pnr => distance_round_trip(pnr.legs));
    histogram(distances.value(), '#dist_hist');

    let durations = actual_pnrs.map(pnr => total_duration(pnr.legs, true)/3600/1000);
    histogram(durations.value(), '#duration_hist');

    let price_per_km = actual_pnrs.map(pnr => pnr.price.cents/distance(pnr.legs)/pnr.travelers.length);
    histogram(price_per_km.value(), '#km_price_hist');

    let avg_speed = actual_pnrs.map(pnr => distance(pnr.legs)/(total_duration(pnr.legs)/3600/1000));
    histogram(avg_speed.value(), '#avg_speed_hist');

    pie(by_card.toPairs().value(), '#card_pie');

    map(legs.value());
}

var json = fetch('tristram.json').then(resp => resp.json());
document.addEventListener("DOMContentLoaded", function(event) {
    json.then(json => display(json));
});
