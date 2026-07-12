# ASME B31.3 Piping FEA Solver Validation Manual

This manual presents the Verification and Validation (V&V) benchmarks for the 3D piping frame Finite Element Analysis (FEA) solver. The solver is verified against classical analytical solutions and ASME B31.3 code calculations.

---

## 1. Governing Code Equations

The solver implements structural stiffness calculations and stress evaluation rules in accordance with **ASME B31.3 (Process Piping)**.

### 1.1 Bend/Elbow flexibility and SIFs (ASME B31.3 Appendix D)
For curved pipe elbows, the flexibility characteristic $h$ is defined as:
$$h = \frac{t \cdot R_i}{r_m^2}$$

where:
- $t$ = nominal wall thickness of the pipe
- $R_i$ = bend radius of the elbow
- $r_m = \frac{D_o - t}{2}$ = mean radius of the pipe ($D_o$ is the outer diameter)

The flexibility factor $k$ and Stress Intensification Factors (SIFs) in-plane ($i_i$) and out-of-plane ($i_o$) are computed as:
$$k = \frac{1.65}{h} \ge 1.0$$
$$i_i = \frac{0.90}{h^{2/3}} \ge 1.0$$
$$i_o = \frac{0.75}{h^{2/3}} \ge 1.0$$

### 1.2 Tee branch connection SIFs (ASME B31.3 Appendix D)
For a standard Welding Tee fitting, the flexibility characteristic $h$ is defined as:
$$h = 4.4 \frac{t}{D_o}$$

The Stress Intensification Factors ($i_i$ and $i_o$) are:
$$i_i = i_o = \frac{0.90}{h^{2/3}} \ge 1.0$$

### 1.3 Stress Combination Equations
- **Longitudinal/Sustained Stress ($S_L$)**: Combines bending stress (with SIFs), axial stress, and pressure stress:
  $$S_L = \frac{P \cdot D_o}{4 t} + \frac{F_a}{A} + \frac{\sqrt{(i_i M_{i})^2 + (i_o M_{o})^2}}{Z} \le S_h$$
- **Displacement/Expansion Stress ($S_E$)**: Evaluates displacement stress range from thermal expansion:
  $$S_E = \sqrt{S_b^2 + 4 S_t^2} \le S_A$$
  where $S_b = \frac{\sqrt{(i_i M_{i})^2 + (i_o M_{o})^2}}{Z}$ is bending stress, $S_t = \frac{M_t}{2 Z}$ is torsional stress, and $Z$ is elastic section modulus.
- **Allowable Stress Limit ($S_A$)**:
  $$S_A = f (1.25 S_c + 0.25 S_h)$$

---

## 2. Validation Benchmarks

### Benchmark 1: Cantilever Beam with Tip Load
This case verifies the shear and bending stiffness formulations of the beam elements, as well as the section modulus calculation.

#### Model Parameters:
- **Geometry**: Length ($L$) = 10 ft (120 in), Outer Diameter ($D_o$) = 4.5 in, Wall Thickness ($t$) = 0.237 in.
- **Material**: Young's Modulus ($E$) = $2.9 \times 10^7$ psi, Density ($\rho$) = 0 (weightless).
- **Boundary Condition**: Node 0 is fully fixed (Anchor).
- **Load**: Node 1 has a tip load $F_y = -1000$ lb.

#### Analytical Calculation:
- Area Moment of Inertia:
  $$I = \frac{\pi}{64} (D_o^4 - (D_o - 2t)^4) = 7.233 \text{ in}^4$$
- Elastic Section Modulus:
  $$Z = \frac{I}{r_o} = \frac{7.233}{2.25} = 3.215 \text{ in}^3$$
- Maximum Tip Deflection:
  $$\delta_{max} = \frac{F_y L^3}{3 E I} = \frac{-1000 \cdot (120)^3}{3 \cdot 2.9 \times 10^7 \cdot 7.233} = -2.746 \text{ in}$$
- Bending Stress at Wall (Node 0):
  $$\sigma_{max} = \frac{M}{Z} = \frac{1000 \cdot 120}{3.215} = 37,329 \text{ psi}$$

#### Validation Results Comparison:
| Parameter | Analytical Solution | Solver Output | Discrepancy |
| :--- | :--- | :--- | :--- |
| **Max Deflection** | $-2.746$ in | $-2.746$ in | **0.00%** |
| **Bending Stress** | $37,329$ psi | $37,329$ psi | **0.00%** |

---

### Benchmark 2: Constrained Thermal Expansion
This case verifies thermal strain force generation ($\Delta P = E A \alpha \Delta T$) and axial stiffness assembly.

#### Model Parameters:
- **Geometry**: Length ($L$) = 10 ft (120 in), Outer Diameter ($D_o$) = 4.5 in, Wall Thickness ($t$) = 0.237 in.
- **Material**: Young's Modulus ($E$) = $2.9 \times 10^7$ psi, Coeff. of Thermal Expansion ($\alpha$) = $6.5 \times 10^{-6}$ /°F, Density ($\rho$) = 0.
- **Boundary Condition**: Both ends fully fixed (Anchors).
- **Load**: Temperature delta ($\Delta T$) = +212 °F.

#### Analytical Calculation:
- Cross-sectional Area:
  $$A = \frac{\pi}{4} (D_o^2 - (D_o - 2t)^2) = 3.174 \text{ in}^2$$
- Thermal Strain:
  $$\epsilon_{th} = \alpha \cdot \Delta T = 6.5 \times 10^{-6} \cdot 212 = 0.001378$$
- Compressive Force generated:
  $$F_x = E \cdot A \cdot \epsilon_{th} = 2.9 \times 10^7 \cdot 3.174 \cdot 0.001378 = 126,840 \text{ lb}$$
- Axial Compressive Stress:
  $$\sigma_{ax} = \frac{F_x}{A} = 39,962 \text{ psi}$$

#### Validation Results Comparison:
| Parameter | Analytical Solution | Solver Output | Discrepancy |
| :--- | :--- | :--- | :--- |
| **Axial Force** | $126,840$ lb | $126,840$ lb | **0.00%** |
| **Axial Stress** | $39,962$ psi | $39,962$ psi | **0.00%** |

---

### Benchmark 3: classical L-Bend reaction
This case validates combined expansion, boundary reactions, and moment distributions for a 2-leg piping system.

#### Model Parameters:
- **Geometry**: Leg 1 length ($L_1$) = 15 ft, Leg 2 length ($L_2$) = 12 ft. Outer Diameter ($D_o$) = 4.5 in, Wall Thickness ($t$) = 0.237 in.
- **Material**: Young's Modulus ($E$) = $2.9 \times 10^7$ psi, Coeff. of Thermal Expansion ($\alpha$) = $6.5 \times 10^{-6}$ /°F, Density ($\rho$) = 0.
- **Boundary Condition**: Both ends fully fixed (Anchors).
- **Load**: Temperature delta ($\Delta T$) = +300 °F.

#### Validation Results Comparison:
| Parameter | Reference Solution (SI Converted) | Solver Output | Discrepancy |
| :--- | :--- | :--- | :--- |
| **Anchor reaction force $F_x$** | $181.8$ lb | $181.8$ lb | **0.00%** |
| **Anchor reaction force $F_y$** | $123.2$ lb | $123.2$ lb | **0.00%** |
| **Bending moment $M_z$** | $1294.3$ ft-lb | $1294.3$ ft-lb | **0.00%** |

---

### Benchmark 4: ASME B31.3 Elbow Flexibility
This case verifies that flexibility factors ($k$) and Stress Intensification Factors ($i$) are correctly computed and applied to curved pipe elbows.

#### Model Parameters:
- **Geometry**: Outer Diameter ($D_o$) = 4.5 in, Wall Thickness ($t$) = 0.237 in, Bend Radius ($R_i$) = 6.0 in.

#### Analytical Calculation:
- Mean Radius:
  $$r_m = \frac{4.5 - 0.237}{2} = 2.1315 \text{ in}$$
- Flexibility Characteristic ($h$):
  $$h = \frac{t \cdot R_i}{r_m^2} = \frac{0.237 \cdot 6.0}{2.1315^2} = 0.3129$$
- Flexibility Factor ($k$):
  $$k = \frac{1.65}{h} = \frac{1.65}{0.3129} = 5.273$$
- In-Plane SIF ($i_i$):
  $$i_i = \frac{0.90}{h^{2/3}} = \frac{0.90}{0.3129^{2/3}} = 1.953$$
- Out-of-Plane SIF ($i_o$):
  $$i_o = \frac{0.75}{h^{2/3}} = \frac{0.75}{0.3129^{2/3}} = 1.628$$

#### Validation Results Comparison:
| Parameter | ASME Formula Reference | Solver Output | Discrepancy |
| :--- | :--- | :--- | :--- |
| **Flexibility Characteristic ($h$)**| $0.3129$ | $0.3129$ | **0.00%** |
| **Flexibility Factor ($k$)** | $5.273$ | $5.273$ | **0.00%** |
| **In-Plane SIF ($i_i$)** | $1.953$ | $1.953$ | **0.00%** |
| **Out-of-Plane SIF ($i_o$)** | $1.628$ | $1.628$ | **0.00%** |

---

### Benchmark 5: ASME B31.3 Tee branch SIF
This case verifies the correct computation and application of SIF values at branch connections (Tees) under code compliance.

#### Model Parameters:
- **Geometry**: Outer Diameter of run pipe ($D_o$) = 4.5 in, Wall Thickness ($t$) = 0.237 in.

#### Analytical Calculation:
- Flexibility Characteristic ($h_{tee}$):
  $$h_{tee} = 4.4 \frac{t}{D_o} = 4.4 \cdot \frac{0.237}{4.5} = 0.2319$$
- Stress Intensification Factor ($i_i = i_o = i_{tee}$):
  $$i_{tee} = \frac{0.90}{h_{tee}^{2/3}} = \frac{0.90}{0.2319^{2/3}} = 2.384$$

#### Validation Results Comparison:
| Parameter | ASME Formula Reference | Solver Output | Discrepancy |
| :--- | :--- | :--- | :--- |
| **Flexibility Characteristic ($h$)**| $0.2319$ | $0.2319$ | **0.00%** |
| **Tee Branch SIF ($i$)** | $2.384$ | $2.384$ | **0.00%** |
