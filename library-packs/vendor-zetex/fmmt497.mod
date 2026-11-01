*
*ZETEX FMMT497 Spice model   Last Revision 8/2/02
*
*This model was prepared using MicroSim PSpice.
*Spice software which does not support RCO & GAMMA will 
*model the quasi-saturation region incorrectly.  The
*resulting model will return optimistic values for
*forward Vcesat, current gain and Tdon.  
*To improve simulation in a simplified model try 
*increasing RE and decreasing BF and IKF
*
.MODEL FMMT497 NPN IS =5E-14 NF =1
+BF =250 IKF=500E-3 VAF=1020 ISE=2.5E-14 NE =1.38
+RCO=60 GAMMA=10E-7 NR =1 BR =5 IKR=0 VAR=55 ISC=5e-12
+NC =1.31 RB =3 RE =0.05 RC =0.05
+CJC=10.95E-12 MJC=0.265 VJC=0.3905 CJE=125.2E-12 
+TF =0.6E-9 TR =0.66e-6 
*
*$
*
*                          (C)  2002 ZETEX PLC
*
*   The copyright in this model  and  the design embodied belong to
*   Zetex PLC ("Zetex"). It is supplied free of charge by Zetex for
*   the purpose  of research  and design  and may be used or copied
*   intact (including this notice) for that purpose only. All other
*   rights  are  reserved.  The model  is believed  accurate but no
*   condition or warranty as to its  merchantability or fitness for
*   purpose  is  given  and  no liability  in respect of any use is
*   accepted by Zetex PLC, its distributors or agents.
*
*
*   Zetex PLC, Fields New Road, Chadderton, Oldham  OL9 8NP
