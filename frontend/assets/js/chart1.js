window.renderChart1 = function (containerSelector, values, mode, dtype, regions) {
  console.log("[chart1] init", { containerSelector, valuesLength: values ? values.length : 0, mode, dtype, regions: regions || [] });

  const container = d3.select(containerSelector);
  container.selectAll("*").remove();

  const node = container.node();
  const outerWidth = node ? node.getBoundingClientRect().width : 600;
  const outerHeight = outerWidth * 0.5;

  console.log("[chart1] dimensions", { outerWidth, outerHeight });

  const margin = { top: 0, right: 50, bottom: 15, left: 50 };
  const width = outerWidth - margin.left - margin.right;
  const height = outerHeight - margin.top - margin.bottom;

  const svg = container
    .append("svg")
    .attr("viewBox", `0 0 ${outerWidth} ${outerHeight}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .style("width", "100%")
    .style("height", "100%")
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  function addYGrid(svg, y, width) {
    console.log("[chart1] addYGrid");
    svg.append("g")
      .attr("class", "grid-y")
      .call(
        d3.axisLeft(y)
          .ticks(5)
          .tickSize(-width)
          .tickFormat("")
      )
      .call(g => g.selectAll("line").attr("stroke", "#202020"))
      .call(g => g.selectAll("path").remove());
  }

  function addXGridNumeric(svg, x, height) {
    console.log("[chart1] addXGridNumeric");
    svg.append("g")
      .attr("class", "grid-x")
      .attr("transform", "translate(0,0)")
      .call(
        d3.axisBottom(x)
          .ticks(6)
          .tickSize(height)
          .tickFormat("")
      )
      .call(g => g.selectAll("line").attr("stroke", "#202020"))
      .call(g => g.selectAll("path").remove());
  }

  function addXGridCategorical(svg, x, height) {
    console.log("[chart1] addXGridCategorical");
    svg.append("g")
      .attr("class", "grid-x")
      .attr("transform", "translate(0,0)")
      .call(
        d3.axisBottom(x)
          .tickSize(height)
          .tickFormat("")
      )
      .call(g => g.selectAll("line").attr("stroke", "#202020"))
      .call(g => g.selectAll("path").remove());
  }

  function drawXAxisNumeric(svg, x, height) {
    console.log("[chart1] drawXAxisNumeric");
    svg
      .append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(6))
      .call(g => g.selectAll("text").attr("fill", "#d6d6d6").style("font-size", "12px"))
      .call(g => g.selectAll("line").attr("stroke", "#adadad"))
      .call(g => g.selectAll("path").attr("stroke", "#adadad"));
  }

  function drawXAxisCategorical(svg, x, height) {
    console.log("[chart1] drawXAxisCategorical");
    svg
      .append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x))
      .call(g => g.selectAll("text").attr("fill", "#d6d6d6").style("font-size", "12px"))
      .call(g => g.selectAll("line").attr("stroke", "#adadad"))
      .call(g => g.selectAll("path").attr("stroke", "#adadad"));
  }

  function drawYAxis(svg, y) {
    console.log("[chart1] drawYAxis");
    svg
      .append("g")
      .call(d3.axisLeft(y).ticks(5))
      .call(g => g.selectAll("text").attr("fill", "#d6d6d6").style("font-size", "12px"))
      .call(g => g.selectAll("line").attr("stroke", "#353535"))
      .call(g => g.selectAll("path").attr("stroke", "#353535"));
  }

  function drawFrame(svg, width, height) {
    console.log("[chart1] drawFrame");
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

  function addAxisLabels(svg, width, height, xLabel, yLabel) {
    if (xLabel) {
      svg.append("text")
        .attr("x", width / 2)
        .attr("y", height + 28)
        .attr("text-anchor", "middle")
        .attr("fill", "#d6d6d6")
        .style("font-size", "12px")
        .text(xLabel);
    }
    if (yLabel) {
      svg.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -height / 2)
        .attr("y", -38)
        .attr("text-anchor", "middle")
        .attr("fill", "#d6d6d6")
        .style("font-size", "12px")
        .text(yLabel);
    }
  }

  //--------------------------------------------------------------------
  //---------------- Analyze/Search + Numeric: Histogram ---------------
  //--------------------------------------------------------------------
  if ((mode === "analyze" || mode === "search") && dtype === "numeric") {
    console.log("[chart1] numeric branch", { mode, dtype });
    const clean = values.filter(v => Number.isFinite(v));
    console.log("[chart1] numeric clean length:", clean.length);
    if (!clean.length) {
      console.warn("[chart1] numeric: no clean values");
      return;
    }

    const sortedAll = clean.slice().sort((a, b) => a - b);
    const pctAll = p => {
      const idx = (p / 100) * (sortedAll.length - 1);
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      if (lo === hi) return sortedAll[lo];
      const t = idx - lo;
      return sortedAll[lo] * (1 - t) + sortedAll[hi] * t;
    };
    const statsAll = {
      min: sortedAll[0],
      p20: pctAll(20),
      p35: pctAll(35),
      median: pctAll(50),
      p80: pctAll(80),
      p90: pctAll(90),
      p97: pctAll(97),
      max: sortedAll[sortedAll.length - 1]
    };
    console.log("[chart1] numeric statsAll:", statsAll);

    const positives = clean.filter(v => v > 0);
    console.log("[chart1] numeric positives length:", positives.length);
    let scaleType = "linear";

    if (positives.length >= 30 && positives.length / clean.length >= 0.8) {
      const arr = positives.slice().sort((a, b) => a - b);
      const pctPos = p => {
        const idx = (p / 100) * (arr.length - 1);
        const lo = Math.floor(idx);
        const hi = Math.ceil(idx);
        if (lo === hi) return arr[lo];
        const t = idx - lo;
        return arr[lo] * (1 - t) + arr[hi] * t;
      };
      const minPos = arr[0];
      const maxPos = arr[arr.length - 1];
      const medianPos = pctPos(50);
      const ratio = (medianPos - minPos) / (maxPos - minPos || 1);
      console.log("[chart1] numeric positives stats:", { minPos, maxPos, medianPos, ratio });
      if (ratio < 0.15) scaleType = "log";
    }

    console.log("[chart1] numeric scaleType:", scaleType);
    const used = scaleType === "log" && positives.length ? positives : clean;
    let minVal = d3.min(used);
    let maxVal = d3.max(used);
    if (minVal === maxVal) maxVal = minVal * 1.01;
    console.log("[chart1] numeric domain:", { minVal, maxVal });

    const x =
      scaleType === "log"
        ? d3.scaleLog().domain([minVal, maxVal]).range([0, width])
        : d3.scaleLinear().domain([minVal, maxVal]).nice().range([0, width]);

    let bins;
    if (scaleType === "log") {
      const logMin = Math.log10(minVal);
      const logMax = Math.log10(maxVal);
      const N = 200;
      const edges = d3.range(N + 1).map(i =>
        Math.pow(10, logMin + (i / N) * (logMax - logMin))
      );
      bins = [];
      for (let i = 0; i < N; i++) {
        const x0 = edges[i];
        const x1 = edges[i + 1];
        const bucket = used.filter(v => v >= x0 && (i === N - 1 ? v <= x1 : v < x1));
        bins.push(Object.assign(bucket, { x0, x1, length: bucket.length }));
      }
      console.log("[chart1] numeric log bins count:", bins.length);
    } else {
      bins = d3
        .bin()
        .domain([minVal, maxVal])
        .thresholds(200)(used);
      console.log("[chart1] numeric linear bins count:", bins.length);
    }

    const y = d3
      .scaleLinear()
      .domain([0, d3.max(bins, d => d.length) || 1])
      .nice()
      .range([height, 0]);

    let colorScale = null;
    if (statsAll.max > statsAll.min) {
      colorScale = d3
        .scaleLinear()
        .domain([
          statsAll.min,
          statsAll.p20,
          statsAll.p35,
          statsAll.median,
          statsAll.p80,
          statsAll.p90,
          statsAll.p97,
          statsAll.max
        ])
        .range([
          "#ffffffff",
          "#fffd6eff",
          "#7dff7dff",
          "#60faffff",
          "#39b0ffff",
          "#215cffff",
          "#9845ffff",
          "#da60ffff"
        ]);
    }
    console.log("[chart1] numeric colorScale defined:", !!colorScale);

    addYGrid(svg, y, width);
    addXGridNumeric(svg, x, height);

    svg
      .selectAll("rect")
      .data(bins)
      .enter()
      .append("rect")
      .attr("x", d => x(d.x0))
      .attr("y", d => y(d.length))
      .attr("width", d => Math.max(0, x(d.x1) - x(d.x0) - 1))
      .attr("height", d => height - y(d.length))
      .attr("fill", d => {
        if (!colorScale) return "#ffffff";
        const mid = (d.x0 + d.x1) / 2;
        return colorScale(mid);
      });

    drawXAxisNumeric(svg, x, height);
    drawYAxis(svg, y);
    drawFrame(svg, width, height);

    const xLabel = (typeof columnName !== "undefined" && columnName) ? columnName : "Value";
    addAxisLabels(svg, width, height, xLabel, "Count");

    console.log("[chart1] numeric render complete");
    return;
  }

  //--------------------------------------------------------------------
  //------------- Analyze/Search + Categorical: Histogram --------------
  //--------------------------------------------------------------------
  if ((mode === "analyze" || mode === "search") && dtype === "categorical") {
    console.log("[chart1] categorical branch", { mode, dtype });
    const cleanCat = values.filter(v => v != null && v !== "");
    console.log("[chart1] categorical clean length:", cleanCat.length);
    if (!cleanCat.length) {
      console.warn("[chart1] categorical: no clean values");
      return;
    }

    const counts = d3.rollups(
      cleanCat,
      v => v.length,
      d => d
    ).sort((a, b) => d3.descending(a[1], b[1]));
    console.log("[chart1] categorical counts length:", counts.length);

    const x = d3
      .scaleBand()
      .domain(counts.map(d => String(d[0])))
      .range([0, width])
      .padding(0.1);

    const y = d3
      .scaleLinear()
      .domain([0, d3.max(counts, d => d[1]) || 1])
      .nice()
      .range([height, 0]);

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

    const colorByCat = new Map();
    counts.forEach((d, i) => {
      const key = String(d[0]);
      if (i < 10) {
        colorByCat.set(key, baseColors[i]);
      } else {
        const r = Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
        const g = Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
        const b = Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
        colorByCat.set(key, `#${r}${g}${b}`);
      }
    });
    console.log("[chart1] categorical colorByCat size:", colorByCat.size);

    addYGrid(svg, y, width);
    addXGridCategorical(svg, x, height);

    const maxBarWidth = 50;

    svg
      .selectAll("rect")
      .data(counts)
      .enter()
      .append("rect")
      .attr("x", d => {
        const bw = x.bandwidth();
        const w = Math.min(bw * 0.6, maxBarWidth);
        return x(String(d[0])) + (bw - w) / 2;
      })
      .attr("y", d => y(d[1]))
      .attr("width", d => {
        const bw = x.bandwidth();
        return Math.min(bw * 0.6, maxBarWidth);
      })
      .attr("height", d => height - y(d[1]))
      .attr("fill", d => colorByCat.get(String(d[0])) || "#ffffff");

    drawXAxisCategorical(svg, x, height);
    drawYAxis(svg, y);
    drawFrame(svg, width, height);

    const xLabel = (typeof columnName !== "undefined" && columnName) ? columnName : "Category";
    addAxisLabels(svg, width, height, xLabel, "Count");

    console.log("[chart1] categorical render complete");
  } else if (!(mode === "compare" && dtype === "numeric")) {
    console.log("[chart1] no matching branch for mode/dtype", { mode, dtype });
  }

  //--------------------------------------------------------------------
  //------------- Compare + Numeric: Histogram -------------------------
  //--------------------------------------------------------------------
  if (mode === "compare" && dtype === "numeric") {
    console.log("[chart1] compare numeric branch START", {
      valuesType: typeof values,
      valuesIsArray: Array.isArray(values),
      regionsParam: regions
    });

    if (!Array.isArray(values) || values.length < 2) {
      console.warn("[chart1] compare numeric: expected [values1, values2]", values);
      return;
    }

    const raw1 = Array.isArray(values[0]) ? values[0] : [];
    const raw2 = Array.isArray(values[1]) ? values[1] : [];

    console.log("[chart1] raw series lengths", {
      raw1: raw1.length,
      raw2: raw2.length
    });

    const clean1 = raw1.filter(v => Number.isFinite(v));
    const clean2 = raw2.filter(v => Number.isFinite(v));

    console.log("[chart1] clean series lengths", {
      clean1: clean1.length,
      clean2: clean2.length
    });

    if (!clean1.length || !clean2.length) {
      console.warn("[chart1] compare numeric: one of the series is empty");
      return;
    }

    const combined = clean1.concat(clean2);
    const sortedAll = combined.slice().sort((a, b) => a - b);

    const pctAll = p => {
      const idx = (p / 100) * (sortedAll.length - 1);
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      if (lo === hi) return sortedAll[lo];
      const t = idx - lo;
      return sortedAll[lo] * (1 - t) + sortedAll[hi] * t;
    };

    const statsAll = {
      min: sortedAll[0],
      p20: pctAll(20),
      p35: pctAll(35),
      median: pctAll(50),
      p80: pctAll(80),
      p90: pctAll(90),
      p97: pctAll(97),
      max: sortedAll[sortedAll.length - 1]
    };
    console.log("[chart1] compare numeric statsAll:", statsAll);

    const positives = combined.filter(v => v > 0);
    let scaleType = "linear";

    if (positives.length >= 30 && positives.length / combined.length >= 0.8) {
      const arr = positives.slice().sort((a, b) => a - b);
      const pctPos = p => {
        const idx = (p / 100) * (arr.length - 1);
        const lo = Math.floor(idx);
        const hi = Math.ceil(idx);
        if (lo === hi) return arr[lo];
        const t = idx - lo;
        return arr[lo] * (1 - t) + arr[hi] * t;
      };
      const minPos = arr[0];
      const maxPos = arr[arr.length - 1];
      const medianPos = pctPos(50);
      const ratio = (medianPos - minPos) / (maxPos - minPos || 1);
      console.log("[chart1] compare numeric positives stats:", { minPos, maxPos, medianPos, ratio });
      if (ratio < 0.15) scaleType = "log";
    }

    console.log("[chart1] compare numeric scaleType:", scaleType);

    const usedCombined = scaleType === "log" && positives.length ? positives : combined;
    const used1 = scaleType === "log" ? clean1.filter(v => v > 0) : clean1;
    const used2 = scaleType === "log" ? clean2.filter(v => v > 0) : clean2;

    let minVal = d3.min(usedCombined);
    let maxVal = d3.max(usedCombined);
    if (minVal === maxVal) maxVal = minVal * 1.01;
    console.log("[chart1] compare numeric domain:", { minVal, maxVal });

    const x =
      scaleType === "log"
        ? d3.scaleLog().domain([minVal, maxVal]).range([0, width])
        : d3.scaleLinear().domain([minVal, maxVal]).nice().range([0, width]);

    let binsCombined;
    if (scaleType === "log") {
      const logMin = Math.log10(minVal);
      const logMax = Math.log10(maxVal);
      const N = 200;
      const edges = d3.range(N + 1).map(i =>
        Math.pow(10, logMin + (i / N) * (logMax - logMin))
      );
      binsCombined = [];
      for (let i = 0; i < N; i++) {
        const x0 = edges[i];
        const x1 = edges[i + 1];
        binsCombined.push({ x0, x1 });
      }
      console.log("[chart1] compare numeric log bins count:", binsCombined.length);
    } else {
      const binGen = d3
        .bin()
        .domain([minVal, maxVal])
        .thresholds(200);
      const tmp = binGen(usedCombined);
      binsCombined = tmp.map(b => ({ x0: b.x0, x1: b.x1 }));
      console.log("[chart1] compare numeric linear bins count:", binsCombined.length);
    }

    const bins = binsCombined.map(b => {
      const x0 = b.x0;
      const x1 = b.x1;
      const c1 = used1.filter(v => v >= x0 && v < x1).length;
      const c2 = used2.filter(v => v >= x0 && v < x1).length;
      return { x0, x1, c1, c2 };
    });

    const y = d3
      .scaleLinear()
      .domain([
        0,
        d3.max(bins, d => Math.max(d.c1, d.c2)) || 1
      ])
      .nice()
      .range([height, 0]);

    let colorScale = null;
    if (statsAll.max > statsAll.min) {
      colorScale = d3
        .scaleLinear()
        .domain([
          statsAll.min,
          statsAll.p20,
          statsAll.p35,
          statsAll.median,
          statsAll.p80,
          statsAll.p90,
          statsAll.p97,
          statsAll.max
        ])
        .range([
          "#ffffffff",
          "#fffd6eff",
          "#7dff7dff",
          "#60faffff",
          "#27a9ffff",
          "#0044ffff",
          "#7300ffff",
          "#b600eeff"
        ]);
    }
    console.log("[chart1] compare numeric colorScale defined:", !!colorScale);

    addYGrid(svg, y, width);
    addXGridNumeric(svg, x, height);

    const region1Color = "#ee9d9dff";
    const region2Color = "#83c4e2ff";

    svg
      .selectAll(".hist-region1")
      .data(bins)
      .enter()
      .append("rect")
      .attr("class", "hist-region1")
      .attr("x", d => x(d.x0))
      .attr("y", d => y(d.c1))
      .attr("width", d => Math.max(0, x(d.x1) - x(d.x0) - 1))
      .attr("height", d => height - y(d.c1))
      .attr("fill", d => {
        if (!colorScale) return "#ffffff";
        const mid = (d.x0 + d.x1) / 2;
        return colorScale(mid);
      })
      .attr("fill-opacity", d => (d.c1 > 0 && d.c2 > 0 ? 0.5 : 0.13));

    svg
      .selectAll(".hist-region2")
      .data(bins)
      .enter()
      .append("rect")
      .attr("class", "hist-region2")
      .attr("x", d => x(d.x0))
      .attr("y", d => y(d.c2))
      .attr("width", d => Math.max(0, x(d.x1) - x(d.x0) - 1))
      .attr("height", d => height - y(d.c2))
      .attr("fill", d => {
        if (!colorScale) return "#ffffff";
        const mid = (d.x0 + d.x1) / 2;
        return colorScale(mid);
      })
      .attr("fill-opacity", d => (d.c1 > 0 && d.c2 > 0 ? 0.5 : 0.13));

    const lineGen = d3.line()
      .x(d => x((d.x0 + d.x1) / 2))
      .y(d => y(d.value))
      .curve(d3.curveMonotoneX);

    const lineData1 = bins.map(b => ({ x0: b.x0, x1: b.x1, value: b.c1 })).filter(d => d.value > 0);
    const lineData2 = bins.map(b => ({ x0: b.x0, x1: b.x1, value: b.c2 })).filter(d => d.value > 0);

    svg
      .append("path")
      .datum(lineData1)
      .attr("fill", "none")
      .attr("stroke", region1Color)
      .attr("stroke-width", 1)
      .attr("d", lineGen);

    svg
      .append("path")
      .datum(lineData2)
      .attr("fill", "none")
      .attr("stroke", region2Color)
      .attr("stroke-width", 1)
      .attr("d", lineGen);

    drawXAxisNumeric(svg, x, height);
    drawYAxis(svg, y);
    drawFrame(svg, width, height);

    const xLabel = (typeof columnName !== "undefined" && columnName) ? columnName : "Value";
    addAxisLabels(svg, width, height, xLabel, "Count");

    const regionLabelsFinal =
      Array.isArray(regions) && regions.length >= 2
        ? regions.slice(0, 2)
        : ["Region 1", "Region 2"];

    console.log("[chart1] legend regionLabelsFinal:", regionLabelsFinal);

    const legend = svg.append("g")
      .attr("transform", `translate(${width - 160}, 10)`);

    const legendItems = legend.selectAll("g")
      .data(regionLabelsFinal)
      .enter()
      .append("g")
      .attr("transform", (d, i) => `translate(0,${i * 18})`);

    legendItems.append("line")
      .attr("x1", 0)
      .attr("x2", 18)
      .attr("y1", 8)
      .attr("y2", 8)
      .attr("stroke", (d, i) => (i === 0 ? region1Color : region2Color))
      .attr("stroke-width", 2);

    legendItems.append("text")
      .attr("x", 24)
      .attr("y", 12)
      .attr("fill", "#d6d6d6")
      .style("font-size", "11px")
      .text(d => d);

    console.log("[chart1] compare numeric render complete");
    return;
  }
};
