window.renderChart2 = function (containerSelector, features, columnName, scale, mode, dtype) {
  console.log("[chart2] start", {
    containerSelector,
    mode,
    dtype,
    scale,
    columnName,
    featureCount: features ? features.length : 0
  });

  const container = d3.select(containerSelector);
  container.selectAll("*").remove();

  const node = container.node();
  const outerWidth = node ? node.getBoundingClientRect().width : 600;
  const outerHeight = outerWidth * 0.5;

  const margin = { top: 0, right: 50, bottom: 15, left: 140 };
  const width = outerWidth - margin.left - margin.right;
  const height = outerHeight - margin.top - margin.bottom;

  const neighborhoodField =
      scale === "city" ? "borocode" :
      scale === "borough" ? "large_n" :
      scale === "large_n" ? "small_n" :
      null;

  //--------------------------------------------------------------------
  //-------------- Analyze/Search + Numeric: Mean ranking --------------
  //--------------------------------------------------------------------
  if ((mode === "analyze" || mode === "search") && dtype === "numeric") {

    console.log("[chart2] analyze+numeric", {
      scale,
      neighborhoodField,
      hasFeatures: !!features,
      featureCount: features ? features.length : 0
    });

    if (!neighborhoodField) {
      console.warn("[chart2] analyze+numeric: no neighborhoodField, abort");
      return;
    }
    if (!features || !features.length) {
      console.warn("[chart2] analyze+numeric: no features, abort");
      return;
    }

    const cleanFeatures = features.filter(f =>
      f &&
      f.properties &&
      f.properties[neighborhoodField] != null &&
      Number.isFinite(+f.properties[columnName])
    );
    console.log("[chart2] analyze+numeric cleanFeatures:", cleanFeatures.length);
    if (!cleanFeatures.length) return;

    const grouped = d3.rollup(
      cleanFeatures,
      v => d3.mean(v, f => +f.properties[columnName]),
      f => f.properties[neighborhoodField]
    );

    let data = Array.from(grouped, ([name, value]) => ({ name, value }));
    data = data.filter(d => d.name && Number.isFinite(d.value));
    console.log("[chart2] analyze+numeric groups after filter:", data.length);
    if (!data.length) return;

    data.sort((a, b) => b.value - a.value);
    data = data.slice(0, 10);

    const svg = container
      .append("svg")
      .attr("viewBox", `0 0 ${outerWidth} ${outerHeight}`)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .style("width", "100%")
      .style("height", "100%")
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const maxVal = d3.max(data, d => d.value) || 1;

    const x = d3
      .scaleLinear()
      .domain([0, maxVal])
      .nice()
      .range([0, width]);

    const y = d3
      .scaleBand()
      .domain(data.map(d => d.name))
      .range([0, height])
      .padding(0.3);

    svg.append("g")
      .attr("class", "grid-y")
      .call(
        d3.axisLeft(y)
          .tickSize(-width)
          .tickFormat("")
      )
      .call(g => g.selectAll("line").attr("stroke", "#202020"))
      .call(g => g.selectAll("path").remove());

    svg.append("g")
      .attr("class", "grid-x")
      .attr("transform", `translate(0,0)`)
      .call(
        d3.axisBottom(x)
          .ticks(6)
          .tickSize(height)
          .tickFormat("")
      )
      .call(g => g.selectAll("line").attr("stroke", "#202020"))
      .call(g => g.selectAll("path").remove());

    svg
      .selectAll("rect")
      .data(data)
      .enter()
      .append("rect")
      .attr("x", 0)
      .attr("y", d => y(d.name))
      .attr("width", d => x(d.value))
      .attr("height", y.bandwidth())
      .attr("fill", "#afbec4ff");

    const xAxis = svg
      .append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(6));

    xAxis.selectAll("text")
      .attr("fill", "#d6d6d6")
      .style("font-size", "9px");

    xAxis.selectAll("line")
      .attr("stroke", "#adadad");

    xAxis.selectAll("path")
      .attr("stroke", "#adadad");

    const yAxis = svg
      .append("g")
      .call(d3.axisLeft(y));

    yAxis.selectAll("text")
      .attr("fill", "#d6d6d6")
      .style("font-size", "9px")
      .call(wrapText, margin.left - 50);

    yAxis.selectAll("line")
      .attr("stroke", "#adadad");

    yAxis.selectAll("path")
      .attr("stroke", "#adadad");

    svg.append("line")
      .attr("x1", 0)
      .attr("x2", width)
      .attr("y1", 0)
      .attr("y2", 0)
      .attr("stroke", "#353535")
      .attr("stroke-width", 1);

    svg.append("line")
      .attr("x1", width)
      .attr("x2", width)
      .attr("y1", 0)
      .attr("y2", height)
      .attr("stroke", "#353535")
      .attr("stroke-width", 1);
  }


  //--------------------------------------------------------------------
  //---- Analyze/Search + Categorical: 100% stacked horizontal bars ----
  //--------------------------------------------------------------------
  if ((mode === "analyze" || mode === "search") && dtype === "categorical") {
    console.log("[chart2] analyze+categorical", {
      featureCount: features ? features.length : 0
    });

    const baseColors = [
      "#ff7474ff",
      "#55dce6ff",
      "#3986ebff",
      "#ddc763ff",
      "#76df84ff",
      "#7652b9ff",
      "#a300eeff",
      "#ff7a62ff",
      "#f3e962ff",
      "#00c896ff"
    ];

    const neighborhoodMap = new Map();
    const globalCatCounts = new Map();

    for (const f of features) {
      if (!f || !f.properties) continue;

      const neigh = f.properties[neighborhoodField];
      const catRaw = f.properties[columnName];

      if (neigh == null || catRaw == null || catRaw === "") continue;

      const neighKey = String(neigh);
      const cat = String(catRaw);

      if (!neighborhoodMap.has(neighKey)) {
        neighborhoodMap.set(neighKey, new Map());
      }
      const catMap = neighborhoodMap.get(neighKey);
      catMap.set(cat, (catMap.get(cat) || 0) + 1);

      globalCatCounts.set(cat, (globalCatCounts.get(cat) || 0) + 1);
    }

    if (!neighborhoodMap.size) return;

    const globalCats = Array.from(globalCatCounts.entries()).sort((a, b) => b[1] - a[1]);
    if (!globalCats.length) return;

    const topCats = globalCats.slice(0, 9).map(d => d[0]);
    const useOther = globalCats.length > 9;
    const finalCats = useOther ? [...topCats, "Other"] : topCats;

    let neighborhoods = Array.from(neighborhoodMap.entries()).map(([name, catMap]) => {
      let total = 0;
      for (const v of catMap.values()) total += v;
      return { name, catMap, total };
    });

    neighborhoods = neighborhoods.filter(d => d.total > 0);
    if (!neighborhoods.length) return;

    neighborhoods.sort((a, b) => b.total - a.total);
    neighborhoods = neighborhoods.slice(0, 10);

    const data = neighborhoods.map(d => {
      const obj = { name: d.name };
      let otherSum = 0;

      for (const [cat, count] of d.catMap.entries()) {
        if (topCats.includes(cat)) {
          obj[cat] = (obj[cat] || 0) + count;
        } else if (useOther) {
          otherSum += count;
        }
      }

      if (useOther) obj["Other"] = otherSum;

      finalCats.forEach(c => {
        if (!Object.prototype.hasOwnProperty.call(obj, c)) obj[c] = 0;
      });

      return obj;
    });

    const svg = container
      .append("svg")
      .attr("viewBox", `0 0 ${outerWidth} ${outerHeight}`)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .style("width", "100%")
      .style("height", "100%")
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleLinear()
      .domain([0, 1])
      .range([0, width]);

    const y = d3
      .scaleBand()
      .domain(data.map(d => d.name))
      .range([0, height])
      .padding(0.3);

    const color = d3.scaleOrdinal()
      .domain(finalCats)
      .range(baseColors.slice(0, finalCats.length));

    const stack = d3.stack()
      .keys(finalCats)
      .offset(d3.stackOffsetExpand);

    const series = stack(data);

    svg.append("g")
      .attr("class", "grid-y")
      .call(
        d3.axisLeft(y)
          .tickSize(-width)
          .tickFormat("")
      )
      .call(g => g.selectAll("line").attr("stroke", "#202020"))
      .call(g => g.selectAll("path").remove());

    svg.append("g")
      .selectAll("g")
      .data(series)
      .enter()
      .append("g")
      .attr("fill", d => color(d.key))
      .selectAll("rect")
      .data(d => d)
      .enter()
      .append("rect")
      .attr("x", d => x(d[0]))
      .attr("y", d => y(d.data.name))
      .attr("width", d => x(d[1]) - x(d[0]))
      .attr("height", y.bandwidth());

    const xAxis = svg
      .append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format(".0%")));

    xAxis.selectAll("text")
      .attr("fill", "#d6d6d6")
      .style("font-size", "9px");

    xAxis.selectAll("line")
      .attr("stroke", "#adadad");

    xAxis.selectAll("path")
      .attr("stroke", "#adadad");

    const yAxis = svg
      .append("g")
      .call(d3.axisLeft(y));

    yAxis.selectAll("text")
      .attr("fill", "#d6d6d6")
      .style("font-size", "9px")
      .call(wrapText, margin.left - 20);

    yAxis.selectAll("line")
      .attr("stroke", "#adadad");

    yAxis.selectAll("path")
      .attr("stroke", "#adadad");

    svg.append("line")
      .attr("x1", 0)
      .attr("x2", width)
      .attr("y1", 0)
      .attr("y2", 0)
      .attr("stroke", "#353535")
      .attr("stroke-width", 1);

    svg.append("line")
      .attr("x1", width)
      .attr("x2", width)
      .attr("y1", 0)
      .attr("y2", height)
      .attr("stroke", "#353535")
      .attr("stroke-width", 1);
  }

  //--------------------------------------------------------------------
  //-------- Compare + Numeric: 4 small side-by-side bar charts --------
  //--------------------------------------------------------------------
  if (mode === "compare" && dtype === "numeric") {
    console.log("[chart2] compare+numeric", {
      scale,
      featureCount: features ? features.length : 0
    });

    const compareField =
      scale === "city" ? "borocode" :
      scale === "borough" ? "large_n" :
      scale === "large_n" ? "large_n" :
      null;

    if (!compareField) {
      console.warn("[chart2] compare+numeric: no compareField, abort");
      return;
    }
    if (!features || !features.length) {
      console.warn("[chart2] compare+numeric: no features, abort");
      return;
    }

    const cleanFeatures = features.filter(f =>
      f &&
      f.properties &&
      f.properties[compareField] != null &&
      Number.isFinite(+f.properties[columnName])
    );
    console.log("[chart2] compare+numeric cleanFeatures:", cleanFeatures.length);
    if (!cleanFeatures.length) return;

    const grouped = d3.group(cleanFeatures, f => f.properties[compareField]);

    let stats = Array.from(grouped, ([name, arr]) => {
      const values = arr
        .map(f => +f.properties[columnName])
        .filter(v => Number.isFinite(v));
      if (!values.length) return null;
      return {
        name: String(name),
        min: d3.min(values),
        max: d3.max(values),
        mean: d3.mean(values),
        median: d3.median(values)
      };
    }).filter(d => d && d.name != null);

    if (stats.length < 2) return;

    stats = stats.map(d => ({
      name: d.name,
      min: Number.isFinite(d.min) ? d.min : 0,
      max: Number.isFinite(d.max) ? d.max : 0,
      mean: Number.isFinite(d.mean) ? d.mean : 0,
      median: Number.isFinite(d.median) ? d.median : 0
    }));

    stats.sort((a, b) => (b.mean || 0) - (a.mean || 0));
    stats = stats.slice(0, 2);

    const regions = stats.map(d => d.name);
    window.compareRegionLabels = regions.slice(0, 2);

    const metrics = ["min", "max", "mean", "median"];
    const titles = ["Min", "Max", "Mean", "Median"];

    const marginCompare = { top: 0, right: 50, bottom: 15, left: 50 };
    const widthCompare = outerWidth - marginCompare.left - marginCompare.right;
    const heightCompare = outerHeight - marginCompare.top - marginCompare.bottom;

    const svg = container
      .append("svg")
      .attr("viewBox", `0 0 ${outerWidth} ${outerHeight}`)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .style("width", "100%")
      .style("height", "100%")
      .append("g")
      .attr("transform", `translate(${marginCompare.left},${marginCompare.top})`);

    const color = d3.scaleOrdinal()
      .domain(regions)
      .range(["#ee9d9dff", "#80c3e2ff"]);

    const chartWidth = widthCompare / metrics.length;

    metrics.forEach((metric, i) => {
      const chartGroup = svg.append("g")
        .attr("transform", `translate(${i * chartWidth},0)`);

      const rawMax = d3.max(stats, d => d[metric]) || 1;
      const paddedMax = rawMax * 1.2;

      const magnitude = Math.pow(10, Math.floor(Math.log10(paddedMax)));
      const niceMax = Math.ceil(paddedMax / magnitude) * magnitude;

      const y = d3.scaleLinear()
        .domain([0, niceMax])
        .range([heightCompare, 0]);

      const yAxis = chartGroup
        .append("g")
        .call(d3.axisLeft(y).ticks(5));

      yAxis.selectAll("text")
        .attr("fill", "#d6d6d6")
        .style("font-size", "12px");

      yAxis.selectAll("line")
        .attr("stroke", "#353535");

      yAxis.selectAll("path")
        .attr("stroke", "#353535");

      const x = d3
        .scaleBand()
        .domain(regions)
        .range([0, chartWidth * 0.9])
        .padding(0.4);

      chartGroup.selectAll("rect")
        .data(stats)
        .enter()
        .append("rect")
        .attr("x", d => x(d.name))
        .attr("y", d => y(d[metric]))
        .attr("width", x.bandwidth())
        .attr("height", d => heightCompare - y(d[metric]))
        .attr("fill", d => color(d.name))
        .attr("stroke", "#1a1a1a")
        .attr("stroke-width", 1);

      const xAxis = chartGroup
        .append("g")
        .attr("transform", `translate(0,${heightCompare})`)
        .call(d3.axisBottom(x).tickSizeInner(0).tickSizeOuter(0).tickFormat(""));

      xAxis.selectAll("line")
        .attr("stroke", "#adadad");

      xAxis.selectAll("path")
        .attr("stroke", "#adadad");

      chartGroup.append("text")
        .attr("x", chartWidth * 0.45)
        .attr("y", -2)
        .attr("text-anchor", "middle")
        .attr("fill", "#d6d6d6")
        .style("font-size", "11px")
        .text(titles[i]);
    });

    const legend = svg.append("g")
      .attr("transform", `translate(${widthCompare - 160},10)`);

    const legendItems = legend.selectAll("g")
      .data(regions)
      .enter()
      .append("g")
      .attr("transform", (d, i) => `translate(0,${i * 18})`);

    legendItems.append("rect")
      .attr("x", 0)
      .attr("y", 4)
      .attr("width", 10)
      .attr("height", 10)
      .attr("fill", d => color(d));

    legendItems.append("text")
      .attr("x", 16)
      .attr("y", 13)
      .attr("fill", "#d6d6d6")
      .style("font-size", "11px")
      .text(d => d);

    svg.append("line")
      .attr("x1", 0)
      .attr("x2", widthCompare)
      .attr("y1", 0)
      .attr("y2", 0)
      .attr("stroke", "#353535")
      .attr("stroke-width", 1);

    svg.append("line")
      .attr("x1", widthCompare)
      .attr("x2", widthCompare)
      .attr("y1", 0)
      .attr("y2", heightCompare)
      .attr("stroke", "#353535")
      .attr("stroke-width", 1);
  }





  //--------------------------------------------------------------------
  function wrapText(text, width) {
    text.each(function () {
      const textSel = d3.select(this);
      const words = textSel.text().split(/\s+/).filter(Boolean);
      const x = textSel.attr("x");
      const y = +textSel.attr("y");
      const dy = parseFloat(textSel.attr("dy") || 0);
      const lineHeight = 1.1;
      let lines = [];
      let line = [];

      textSel.text("");
      let tspan = textSel.append("tspan").attr("x", x).attr("y", y).attr("dy", dy + "em");

      words.forEach(word => {
        line.push(word);
        tspan.text(line.join(" "));
        if (tspan.node().getComputedTextLength() > width && line.length > 1) {
          line.pop();
          tspan.text(line.join(" "));
          lines.push(line.join(" "));
          line = [word];
          tspan = textSel.append("tspan").attr("x", x).attr("y", y).attr("dy", dy + "em").text(word);
        }
      });

      if (line.length) {
        tspan.text(line.join(" "));
        lines.push(line.join(" "));
      }

      textSel.selectAll("tspan").remove();

      const totalLines = lines.length;
      const startDy = dy - ((totalLines - 1) / 2) * lineHeight;

      lines.forEach((ln, i) => {
        textSel.append("tspan")
          .attr("x", x)
          .attr("y", y)
          .attr("dy", (startDy + i * lineHeight) + "em")
          .text(ln);
      });
    });
  }
};
