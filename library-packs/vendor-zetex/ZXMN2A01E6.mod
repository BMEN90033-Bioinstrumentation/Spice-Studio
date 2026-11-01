*
*Zetex ZXMN2A01E6 Spice Model v2.0 Last Revised 22/2/05
*
.SUBCKT ZXMN2A01E6 30 40 50
*------connections-------D-G-S
M1 6 20 5 5 Nmod L=1.16E-6 W=0.46
M2 5 20 5 6 Pmod L=1.3E-6 W=0.22
RG 4 2 5
RIN 2 5 1E12
RD 3 6 Rmod1 0.036
RL 3 5 3E9
C1 2 5 8.5E-12
C2 3 4 3E-12
D1 5 3  Dbodymod
Egt1 2 20 21 5 1
Vgt1 5 22 1
Igt1 5 21 1
Rgt 21 22 Rmod2 1
LD 3 30 0.3E-9
LG 4 40 1.9E-9
LS 5 50 1.9E-9
.MODEL Nmod NMOS (LEVEL=3 TOX=4.5E-8 NSUB=3.5E16 VTO=1.31
+KP=4E-5 RS=.03 NFS=2E11 KAPPA=0.06 UO=650 IS=1E-15 N=10)
.MODEL Pmod PMOS (LEVEL=3 TOX=4.5E-8 NSUB=3.3E16
+TPG=-1 IS=1E-15 N=10)
.MODEL Dbodymod D (IS=5E-12 RS=.025 IKF=0.1 TRS1=1.5e-3
+CJO=230e-12  BV=23)
.MODEL Rmod1 RES (TC1=5.8e-3 TC2=1.3E-5)
.MODEL Rmod2 RES (TC1=-3e-4 TC2=0)
.ENDS
*
*$
*
*                (c)  2005 Zetex Semiconductors plc
*
*   The copyright in these models  and  the designs embodied belong
*   to Zetex Semiconductors plc (" Zetex ").  They  are  supplied
*   free of charge by Zetex for the purpose of research and design
*   and may be used or copied intact  (including this notice)  for
*   that purpose only.  All other rights are reserved. The models
*   are believed accurate but  no condition  or warranty  as to their
*   merchantability or fitness for purpose is given and no liability
*   in respect of any use is accepted by Zetex PLC, its distributors
*   or agents.
*
*   Zetex Semiconductors plc, Zetex Technology Park, Chadderton,
*   Oldham, United Kingdom, OL9 9LL
