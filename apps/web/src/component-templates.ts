export const COMPONENT_TEMPLATES = [
  { name: "分区矩形", category: "图形与流程", mode: "可视编辑", source: String.raw`\begin{tikzpicture}
\node[rectangle split,rectangle split parts=3,rectangle split horizontal,draw,inner sep=6pt,rectangle split part fill={white,none,blue!10}] (record) {标题\nodepart{two}$x^2+y^2$\nodepart{three}内容};
\draw[-{Stealth[length=8pt,width=5pt]}] (record.south)--++(0,-1);
\end{tikzpicture}` },
  { name: "矩阵表格", category: "图形与流程", mode: "可视编辑", source: String.raw`\begin{tikzpicture}
\matrix[matrix of nodes,nodes={draw,minimum width=12mm,minimum height=8mm},row sep=-\pgflinewidth,column sep=-\pgflinewidth] { A & B & C \\ 1 & 2 & 3 \\ 4 & 5 & 6 \\ };
\end{tikzpicture}` },
  { name: "流程图", category: "图形与流程", mode: "可视编辑", source: String.raw`\begin{tikzpicture}[node distance=12mm]
\node[draw,rounded corners,fill=blue!10] (start) {开始};
\node[draw,diamond,below=of start,aspect=2] (decision) {条件};
\node[draw,below=of decision,fill=green!10] (end) {完成};
\draw[-{Stealth[scale=1.3]}] (start)--(decision);
\draw[-{Stealth[scale=1.3]}] (decision)--node[right]{是}(end);
\end{tikzpicture}` },
  { name: "说明气泡", category: "图形与流程", mode: "可视编辑", source: String.raw`\begin{tikzpicture}
\node[draw,rectangle callout,callout relative pointer={(0.5,-0.7)},fill=yellow!15] {说明文字};
\end{tikzpicture}` },
  { name: "电路", category: "专业图与电路", mode: "TeX 编译", source: String.raw`\begin{circuitikz}
\draw (0,0) to[battery1,l=$V$] (0,3) to[R,l=$R$] (3,3) to[C,l=$C$] (3,0)--(0,0);
\end{circuitikz}` },
  { name: "状态图", category: "专业图与电路", mode: "可视编辑", source: String.raw`\begin{tikzpicture}
\node[draw,circle] (a) at (0,0) {$q_0$};
\node[draw,circle,double] (b) at (3,0) {$q_1$};
\draw[-{Stealth[scale=1.4]}] (a) to[bend left=25] node[above] {$a$} (b);
\draw[-{Stealth[scale=1.4]}] (b) to[bend left=25] node[below] {$b$} (a);
\end{tikzpicture}` },
  { name: "函数曲线", category: "函数与统计", mode: "TeX 编译", source: String.raw`\begin{tikzpicture}
\begin{axis}[axis lines=middle,xlabel=$x$,ylabel=$y$,domain=-3:3,samples=100,grid=major]
\addplot[blue,thick]{x^2};
\addplot[red,dashed]{sin(deg(x))};
\end{axis}
\end{tikzpicture}` },
  { name: "柱状统计图", category: "函数与统计", mode: "TeX 编译", source: String.raw`\begin{tikzpicture}
\begin{axis}[ybar,ymin=0,bar width=12pt,symbolic x coords={A,B,C},xtick=data,nodes near coords,grid=major]
\addplot[fill=blue!25] coordinates {(A,12) (B,21) (C,15)};
\end{axis}
\end{tikzpicture}` },
  { name: "箱线统计图", category: "函数与统计", mode: "TeX 编译", source: String.raw`\begin{tikzpicture}
\begin{axis}[boxplot/draw direction=y,xtick={1},xticklabels={Sample}]
\addplot+[boxplot prepared={lower whisker=1,lower quartile=2,median=3,upper quartile=4,upper whisker=6}] coordinates {};
\end{axis}
\end{tikzpicture}` },
] as const;
